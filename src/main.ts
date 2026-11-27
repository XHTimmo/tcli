import { attachTerminalInput } from "./terminal-input";
import { ensurePi } from "./pi";
import { FileTree } from "./file-tree";
import { explorerMode, matchesShortcut, openSettings, shortcutLabel } from "./settings";
import { initDashboard } from "./dashboard";
import type { FileEditor, FileDocument } from "./editor";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { Channel, invoke } from "@tauri-apps/api/core";
import { ask, open } from "@tauri-apps/plugin-dialog";
import "@xterm/xterm/css/xterm.css";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

// ---- projects: a folder with terminal and file tabs ----
interface TerminalTab {
  id: number; kind: "pi" | "shell"; project: Project;
  term: Terminal; fit: FitAddon; el: HTMLElement; tabEl: HTMLElement; disposeInput: () => void;
  ready: Promise<void>;
}
interface FileTab {
  id: number; kind: "file"; project: Project;
  editor: FileEditor; el: HTMLElement; tabEl: HTMLElement;
}
type Tab = TerminalTab | FileTab;
interface Project {
  path: string; tabs: Tab[]; active: Tab | null;
  dir: string; // directory the explorer last showed for this project
  chip: HTMLElement;
}
const projects: Project[] = [];
let cur: Project | null = null;
let nextId = 1;
let cwd = ""; // directory the explorer is showing; new tabs start here
const base = (p: string) => p.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || p;
const STORE = "tcli.projects";

function save() {
  localStorage.setItem(STORE, JSON.stringify({ paths: projects.map((p) => p.path), cur: cur?.path }));
}

async function openTab(p: Project, kind: "pi" | "shell", dir: string) {
  let piPath: string | null = null;
  try {
    if (kind === "pi") {
      piPath = await ensurePi();
      if (!piPath || !projects.includes(p)) return;
    }
  } catch (error) { explorerMessage(`无法配置 pi：${error}`, true); return; }
  const id = nextId++;
  const el = document.createElement("div");
  el.className = "pane hidden";
  $("terms").append(el);
  const openWebLink = (event: MouseEvent, url: string) => {
    if (event.button === 0 && !term.hasSelection()) {
      void invoke("open_web_url", { url }).catch(error => explorerMessage(`无法打开链接：${error}`, true));
    }
  };
  const term: Terminal = new Terminal({
    linkHandler: {
      activate(event, url) {
        // Fullscreen pi handles OSC 8 clicks through the PTY mouse protocol.
        if (kind === "pi" && term.modes.mouseTrackingMode !== "none" && !event.shiftKey) return;
        openWebLink(event, url);
      },
    },
    fontFamily: '"Cascadia Mono", Consolas, monospace',
    fontSize: 13,
    scrollback: 3000,
    cursorBlink: true,
    theme: { background: "#16181d" },
  });
  const fit = new FitAddon();
  term.loadAddon(fit);
  term.loadAddon(new WebLinksAddon(openWebLink));
  term.open(el);

  const tabEl = document.createElement("div");
  tabEl.className = "tab";
  const t = document.createElement("span");
  t.className = "t";
  t.textContent = (kind === "pi" ? "π " : "› ") + (dir === p.path ? "" : base(dir));
  t.title = dir;
  if (dir === p.path) t.textContent += kind === "pi" ? "pi" : "shell";
  const x = document.createElement("span");
  x.className = "x";
  x.textContent = "×";
  tabEl.append(t, x);
  const disposeInput = attachTerminalInput(term, el, kind, message => explorerMessage(message, true));
  const tab: TerminalTab = { id, kind, project: p, term, fit, el, tabEl, disposeInput, ready: Promise.resolve() };
  tabEl.onclick = () => selectTab(tab);
  x.onclick = (ev) => { ev.stopPropagation(); void closeTab(tab); };
  p.tabs.push(tab);
  selectTab(tab);

  const onData = new Channel<ArrayBuffer>();
  onData.onmessage = (buf) => term.write(new Uint8Array(buf));
  let writes = Promise.resolve();
  const send = (data: string | number[]) => {
    // Serialize IPC writes so paste, keystrokes and terminal replies retain their order.
    writes = writes.then(() => tab.ready).then(() => invoke<void>("pty_write", { id, data }))
      .catch(error => explorerMessage(`终端输入失败：${error}`, true));
  };
  term.onData(send);
  term.onBinary(data => send(Array.from(data, c => c.charCodeAt(0) & 255)));
  term.onResize(({ cols, rows }) => {
    void tab.ready.then(() => invoke("pty_resize", { id, cols, rows }))
      .catch(error => explorerMessage(`终端尺寸更新失败：${error}`, true));
  });
  tab.ready = invoke<void>("pty_spawn", { id, kind, cols: term.cols, rows: term.rows, cwd: dir, piPath, onData });
  try {
    await tab.ready;
  } catch (error) {
    disposeInput();
    term.dispose();
    el.remove();
    p.tabs = p.tabs.filter(t => t !== tab);
    if (p.active === tab) p.active = p.tabs.at(-1) ?? null;
    showActive();
    explorerMessage(`无法启动 ${kind}：${error}。可在设置中检查 pi 路径。`, true);
  }
}

/** Show only the current project's active tab; every other pane stays hidden. */
function showActive() {
  const shown = cur?.active ?? null;
  for (const p of projects) {
    for (const t of p.tabs) {
      t.el.classList.toggle("hidden", t !== shown);
      t.tabEl.classList.toggle("on", t === shown);
    }
  }
  renderTabs();
  if (shown?.kind === "file") shown.editor.focus();
  else if (shown) { shown.fit.fit(); shown.term.focus(); }
}

function selectTab(tab: Tab) {
  tab.project.active = tab;
  if (cur !== tab.project) { void switchProject(tab.project); return; }
  showActive();
}

async function confirmClose(editors: FileEditor[]) {
  if (!editors.length) return true;
  return (await import("./editor")).confirmClose(editors);
}
const fileEditors = (tabs: Tab[]) => tabs.flatMap(tab => tab.kind === "file" ? [tab.editor] : []);
let closing = false;
async function disposeTab(tab: Tab) {
  if (tab.kind === "file") tab.editor.dispose();
  else {
    await tab.ready.catch(() => {});
    await invoke("pty_close", { id: tab.id });
    tab.disposeInput();
    tab.term.dispose();
    tab.el.remove();
  }
}
async function closeTab(tab: Tab) {
  if (closing) return;
  closing = true;
  try {
    if (!(await confirmClose(fileEditors([tab])))) return;
    const p = tab.project;
    if (!p.tabs.includes(tab)) return;
    await disposeTab(tab);
    const i = p.tabs.indexOf(tab);
    if (i < 0) return; // A failed spawn may already have removed this tab.
    p.tabs.splice(i, 1);
    if (p.active === tab) p.active = p.tabs[Math.min(i, p.tabs.length - 1)] ?? null;
    showActive();
  } finally { closing = false; }
}

let fileRequest = 0;
async function openFile(path: string) {
  const request = ++fileRequest;
  const project = cur;
  if (!project) return;
  explorerMessage("正在读取文件…");
  try {
    const [doc, { FileEditor }] = await Promise.all([
      invoke<FileDocument>("read_file", { path }), import("./editor"),
    ]);
    if (!projects.includes(project)) return;
    const existing = project.tabs.find(tab => tab.kind === "file" && tab.editor.path === doc.path);
    if (existing) { if (cur === project && request === fileRequest) selectTab(existing); explorerMessage(""); return; }
    const tabEl = document.createElement("div");
    tabEl.className = "tab file-tab";
    const title = document.createElement("span");
    title.className = "t";
    title.title = doc.path;
    const x = document.createElement("span");
    x.className = "x";
    x.textContent = "×";
    let editor: FileEditor | undefined;
    const updateTitle = () => {
      title.textContent = `${editor?.dirty ? "● " : ""}${base(doc.path)}`;
      tabEl.classList.toggle("dirty", editor?.dirty ?? false);
    };
    editor = new FileEditor(doc, updateTitle);
    updateTitle();
    const tab: FileTab = { id: nextId++, kind: "file", project, editor, el: editor.el, tabEl };
    tabEl.append(title, x);
    tabEl.onclick = () => selectTab(tab);
    x.onclick = event => { event.stopPropagation(); void closeTab(tab); };
    $("terms").append(editor.el);
    project.tabs.push(tab);
    if (cur === project && request === fileRequest) selectTab(tab);
    explorerMessage("");
  } catch (error) { explorerMessage(`无法打开文件：${error}`, true); }
}

async function switchProject(p: Project) {
  cur = p;
  save();
  renderProjects();
  showActive();
  void loadDir(p.dir);
  if (!p.tabs.length) await openTab(p, "pi", p.path);
}

async function openProject(path: string) {
  const existing = projects.find((p) => p.path === path);
  if (existing) { await switchProject(existing); return; }
  const chip = document.createElement("div");
  const p: Project = { path, tabs: [], active: null, dir: path, chip };
  projects.push(p);
  await switchProject(p);
}

async function closeProject(p: Project) {
  if (closing) return;
  closing = true;
  try {
    const terminals = p.tabs.filter(tab => tab.kind !== "file").length;
    if (terminals && !(await ask(`关闭工程 ${base(p.path)}？其中 ${terminals} 个终端会被结束。`, { title: "tcli", kind: "warning" }))) return;
    if (!(await confirmClose(fileEditors(p.tabs)))) return;
    for (const t of [...p.tabs]) await disposeTab(t);
    p.tabs = [];
    const i = projects.indexOf(p);
    projects.splice(i, 1);
    if (cur === p) {
      cur = null;
      const next = projects[Math.min(i, projects.length - 1)];
      if (next) await switchProject(next);
      else { tree?.dispose(); tree = null; ++directoryRequest; cwd = ""; $("cwd").textContent = ""; $("files").replaceChildren(); renderProjects(); renderTabs(); save(); }
    } else { renderProjects(); save(); }
  } finally { closing = false; }
}

async function pickProject() {
  const dir = await open({ directory: true, multiple: false, defaultPath: cwd || undefined, title: "打开工程文件夹" });
  if (typeof dir === "string") await openProject(dir);
}

function renderProjects() {
  const add = document.createElement("span");
  add.className = "add";
  add.textContent = "+ 打开工程";
  add.title = `选择一个文件夹作为工程${shortcutLabel("openProject") ? ` (${shortcutLabel("openProject")})` : ""}`;
  add.onclick = () => void pickProject();
  for (const p of projects) {
    const c = p.chip;
    c.className = "tab" + (p === cur ? " on" : "");
    const t = document.createElement("span");
    t.className = "t";
    t.textContent = base(p.path);
    t.title = p.path;
    const x = document.createElement("span");
    x.className = "x";
    x.textContent = "×";
    x.onclick = (ev) => { ev.stopPropagation(); void closeProject(p); };
    c.replaceChildren(t, x);
    c.onclick = () => void switchProject(p);
  }
  $("projects").replaceChildren(...projects.map((p) => p.chip), add);
}

function renderTabs() {
  if (!cur) { $("tabs").replaceChildren(); return; }
  const p = cur;
  const add = (label: string, title: string, kind: "pi" | "shell") => {
    const b = document.createElement("span");
    b.className = "add";
    b.textContent = label;
    b.title = title;
    b.onclick = () => void openTab(p, kind, cwd || p.path);
    return b;
  };
  $("tabs").replaceChildren(
    ...p.tabs.map((t) => t.tabEl),
    add("+ pi", "在资源管理器当前目录新开 pi", "pi"),
    add("+ shell", "在资源管理器当前目录新开 PowerShell", "shell"),
  );
}

// Only the visible tab needs refitting.
new ResizeObserver(() => {
  const tab = cur?.active;
  if (tab && tab.kind !== "file") tab.fit.fit();
}).observe($("terms"));
$("cwd").onclick = () => { if (cur) void loadDir(cur.path); };
$("settings").onclick = openSettings;
function updateShortcutHints() {
  $("kill-shortcut").textContent = shortcutLabel("killProcess") || "未设置快捷键";
  $("settings").title = `设置快捷键${shortcutLabel("settings") ? ` (${shortcutLabel("settings")})` : ""}`;
}
updateShortcutHints();
window.addEventListener("shortcuts-changed", () => { renderProjects(); updateShortcutHints(); armed = false; $("proc-msg").textContent = ""; });
window.addEventListener("keydown", (ev) => {
  if (ev.repeat || ev.isComposing || ev.keyCode === 229 || document.querySelector("dialog[open]")) return;
  const p = cur;
  let run: (() => void) | undefined;
  if (matchesShortcut(ev, "settings")) run = openSettings;
  else if (matchesShortcut(ev, "openProject")) run = () => { void pickProject(); };
  else if (matchesShortcut(ev, "newPi") && p) run = () => { void openTab(p, "pi", cwd || p.path); };
  else if (matchesShortcut(ev, "newShell") && p) run = () => { void openTab(p, "shell", cwd || p.path); };
  else if (matchesShortcut(ev, "closeTab") && p?.active) run = () => { void closeTab(p.active!); };
  else if (matchesShortcut(ev, "saveFile") && p?.active?.kind === "file") {
    const editor = p.active.editor;
    run = () => { void editor.save(); };
  } else if (matchesShortcut(ev, "openExplorer") && cwd) run = () => { void revealInExplorer(cwd); };
  else if (matchesShortcut(ev, "nextTab") && p && p.tabs.length > 1 && p.active) {
    run = () => selectTab(p.tabs[(p.tabs.indexOf(p.active!) + 1) % p.tabs.length]);
  }
  if (run) { ev.preventDefault(); ev.stopPropagation(); run(); }
}, { capture: true });

async function start() {
  // Restore the last session's projects. Terminals are only spawned when a project is first shown.
  let saved: { paths?: string[]; cur?: string } = {};
  try { saved = JSON.parse(localStorage.getItem(STORE) ?? "{}"); } catch { /* ignore */ }
  for (const path of saved.paths ?? []) {
    try { await invoke("list_dir", { path }); } catch { continue; }
    projects.push({ path, tabs: [], active: null, dir: path, chip: document.createElement("div") });
  }
  if (!projects.length) {
    await openProject(await invoke<string>("home_dir"));
    return;
  }
  await switchProject(projects.find((p) => p.path === saved.cur) ?? projects[0]);
}

// ---- explorer ----
interface Entry { name: string; dir: boolean }
const sep = (p: string) => (p.includes("\\") ? "\\" : "/");
const join = (a: string, b: string) => a.replace(/[\\/]$/, "") + sep(a) + b;
const parent = (p: string) => {
  const t = p.replace(/[\\/]+$/, "");
  const i = Math.max(t.lastIndexOf("\\"), t.lastIndexOf("/"));
  return i <= 2 && /^[A-Za-z]:/.test(t) ? t.slice(0, i + 1) : t.slice(0, i) || t;
};

let directoryRequest = 0;
let tree: FileTree | null = null;
const expandedDirectories = new WeakMap<Project, Set<string>>();
window.addEventListener("explorer-mode-changed", () => {
  if (cur) void loadDir(cur.dir);
});
function explorerMessage(message: string, error = false) {
  $("explorer-message").textContent = message;
  $("explorer-message").classList.toggle("error", error);
}
async function loadDir(path: string, preserveFilter = false) {
  closeExplorerMenu();
  const request = ++directoryRequest;
  const project = cur;
  tree?.dispose();
  tree = null;
  const treeMode = explorerMode() === "tree";
  const ul = $("files");
  delete ul.dataset.dropDirectory;
  ul.setAttribute("role", treeMode ? "tree" : "list");
  ul.setAttribute("aria-label", treeMode ? "工程文件树" : "目录文件列表");
  const filter = $<HTMLInputElement>("file-filter");
  if (!preserveFilter) filter.value = "";
  filter.placeholder = treeMode ? "筛选已加载的文件…" : "筛选当前目录…";
  if (treeMode && project) {
    path = project.path;
    cwd = path;
    $("cwd").textContent = path;
    $("cwd").title = `${path}\n工程文件树 · 点击刷新`;
    ul.replaceChildren();
    ul.dataset.dropDirectory = path;
    explorerMessage("");
    let expanded = expandedDirectories.get(project);
    if (!expanded) { expanded = new Set(); expandedDirectories.set(project, expanded); }
    const currentTree = new FileTree(ul, expanded,
      (file, alt) => { if (alt) void insertPath(file); else void openFile(file); },
      message => explorerMessage(message, true));
    tree = currentTree;
    currentTree.setFilter(filter.value);
    try { await currentTree.load(path); }
    catch (error) { if (request === directoryRequest && cur === project) explorerMessage(`无法读取目录：${error}`, true); }
    return;
  }
  let entries: Entry[];
  try { entries = await invoke<Entry[]>("list_dir", { path }); }
  catch (error) { if (request === directoryRequest && cur === project) explorerMessage(`无法读取目录：${error}`, true); return; }
  if (request !== directoryRequest || cur !== project) return;
  explorerMessage("");
  cwd = path;
  if (project) project.dir = path;
  $("cwd").textContent = path;
  $("cwd").title = `${path}\n点击返回工程目录`;
  ul.replaceChildren();
  ul.dataset.dropDirectory = path;
  const up = document.createElement("li");
  up.textContent = "..";
  up.className = "dir";
  up.dataset.path = parent(path);
  up.dataset.dir = "true";
  up.onclick = () => void loadDir(parent(path));
  ul.append(up);
  for (const e of entries) {
    const li = document.createElement("li");
    li.textContent = (e.dir ? "▸ " : "  ") + e.name;
    if (e.dir) li.className = "dir";
    li.dataset.name = e.name.toLowerCase();
    li.hidden = !li.dataset.name.includes(filter.value.trim().toLowerCase());
    li.dataset.path = join(path, e.name);
    li.dataset.dir = String(e.dir);
    li.title = `${e.name}${e.dir ? "" : "\n点击打开 · Alt+点击插入路径到终端"}`;
    li.tabIndex = 0;
    const activate = (alt: boolean) => e.dir ? void loadDir(join(path, e.name)) : alt ? void insertPath(join(path, e.name)) : void openFile(join(path, e.name));
    li.onclick = event => activate(event.altKey);
    li.onkeydown = event => { if (event.key === "Enter") { event.preventDefault(); activate(event.altKey); } };
    ul.append(li);
  }
}
$("file-filter").oninput = () => {
  const filter = $<HTMLInputElement>("file-filter").value.trim().toLowerCase();
  if (tree) { tree.setFilter(filter); return; }
  for (const li of $("files").children) (li as HTMLElement).hidden = !!(li as HTMLElement).dataset.name && !(li as HTMLElement).dataset.name!.includes(filter);
};
async function copyDroppedFiles(paths: string[], directory: string) {
  const project = cur;
  if (!project) return;
  const view = cwd;
  const failures: string[] = [];
  explorerMessage(`正在复制 ${paths.length} 个文件到 ${directory}…`);
  for (const source of paths) {
    try { await invoke("copy_dropped_file", { source, directory }); }
    catch (error) { failures.push(`${base(source)}（${error}）`); }
  }
  if (cur !== project || cwd !== view) return;
  const copied = paths.length - failures.length;
  if (copied) {
    if (tree && directory !== view) expandedDirectories.get(project)?.add(directory);
    await loadDir(view, true);
  }
  if (cur === project && cwd === view) {
    const details = failures.length ? `。${failures.length} 项未复制：${failures.join("、")}` : "";
    explorerMessage(`已复制 ${copied} 个文件到 ${directory}${details}`, failures.length > 0);
  }
}

let highlightedDropTarget: HTMLElement | null = null;
void getCurrentWebview().onDragDropEvent(({ payload }) => {
  highlightedDropTarget?.classList.remove("drop-target");
  highlightedDropTarget = null;
  if (payload.type === "leave" || !cur || !cwd || $("files").dataset.dropDirectory !== cwd) return;
  const { x, y } = payload.position;
  const hit = document.elementFromPoint(x / window.devicePixelRatio, y / window.devicePixelRatio);
  if (!hit?.closest("#files, #cwd")) return;
  const row = hit.closest<HTMLElement>("li[data-path]");
  const directory = row?.dataset.dir === "true" ? row.dataset.path! : row?.dataset.parent || cwd;
  if (payload.type === "drop") {
    if (payload.paths.length) void copyDroppedFiles(payload.paths, directory);
    return;
  }
  highlightedDropTarget = row?.dataset.dir === "true" ? row :
    $("files").querySelector<HTMLElement>(`li[data-dir="true"][data-path="${CSS.escape(directory)}"]`) || $("cwd");
  highlightedDropTarget.classList.add("drop-target");
}).catch(error => explorerMessage(`无法启用拖入复制：${error}`, true));

async function revealInExplorer(path: string) {
  try { await invoke("open_in_explorer", { path }); }
  catch (error) { explorerMessage(`无法打开资源管理器：${error}`, true); }
}
async function pickFile() {
  if (!cur) return;
  const path = await open({ directory: false, multiple: false, defaultPath: cwd || cur.path, title: "打开文件" });
  if (typeof path === "string") await openFile(path);
}

let explorerMenu: HTMLElement | null = null;
let menuOrigin: HTMLElement | null = null;
function closeExplorerMenu(restoreFocus = false) {
  explorerMenu?.remove();
  explorerMenu = null;
  if (restoreFocus && menuOrigin?.isConnected) menuOrigin.focus();
  menuOrigin = null;
}
function showExplorerMenu(event: MouseEvent) {
  event.preventDefault();
  closeExplorerMenu();
  if (!cwd || !cur) return;
  const row = (event.target as HTMLElement).closest<HTMLElement>("#files li");
  const path = row?.dataset.path || cwd;
  const directory = !row || row.dataset.dir === "true";
  const currentDir = cwd;
  const project = cur;
  const menu = document.createElement("div");
  menu.className = "explorer-menu";
  menu.setAttribute("role", "menu");
  menu.setAttribute("aria-label", "文件操作");
  menuOrigin = row || document.activeElement as HTMLElement;
  const action = (label: string, run: () => unknown, enabled = true) => {
    const button = document.createElement("button");
    button.textContent = label;
    button.type = "button";
    button.setAttribute("role", "menuitem");
    button.disabled = !enabled;
    button.onclick = () => {
      closeExplorerMenu(true);
      if (cur !== project) return;
      void Promise.resolve().then(run).catch(error => explorerMessage(`操作失败：${error}`, true));
    };
    menu.append(button);
  };
  if (row) action(directory ? tree ? tree.isExpanded(path) ? "折叠目录" : "展开目录" : "进入目录" : "打开文件",
    () => directory ? tree ? tree.toggle(path) : loadDir(path) : openFile(path));
  action("插入路径到终端", () => insertPath(path), !!cur.active && cur.active.kind !== "file");
  action(directory ? "在资源管理器中打开" : "在资源管理器中定位", () => revealInExplorer(path));
  menu.append(document.createElement("hr"));
  action("选择文件打开…", pickFile);
  action("刷新", () => loadDir(currentDir));
  if (!tree) action("上一级目录", () => loadDir(parent(currentDir)), parent(currentDir) !== currentDir);
  menu.onkeydown = key => {
    const buttons = [...menu.querySelectorAll<HTMLButtonElement>("button:not(:disabled)")];
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    let next: number;
    if (key.key === "ArrowDown") next = (index + 1) % buttons.length;
    else if (key.key === "ArrowUp") next = (index - 1 + buttons.length) % buttons.length;
    else if (key.key === "Home") next = 0;
    else if (key.key === "End") next = buttons.length - 1;
    else if (key.key === "Escape" || key.key === "Tab") {
      closeExplorerMenu(true);
      if (key.key === "Escape") key.preventDefault();
      key.stopPropagation();
      return;
    } else return;
    key.preventDefault();
    key.stopPropagation();
    buttons[next]?.focus();
  };
  document.body.append(menu);
  explorerMenu = menu;
  const rect = menu.getBoundingClientRect();
  menu.style.left = `${Math.max(0, Math.min(event.clientX, window.innerWidth - rect.width))}px`;
  menu.style.top = `${Math.max(0, Math.min(event.clientY, window.innerHeight - rect.height))}px`;
  menu.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
}
$("files").oncontextmenu = showExplorerMenu;
$("cwd").oncontextmenu = showExplorerMenu;
document.addEventListener("pointerdown", event => {
  if (explorerMenu && !explorerMenu.contains(event.target as Node)) closeExplorerMenu();
}, true);
document.addEventListener("scroll", () => closeExplorerMenu(), true);
window.addEventListener("resize", () => closeExplorerMenu());
window.addEventListener("blur", () => closeExplorerMenu());
async function insertPath(p: string) {
  const t = cur?.active;
  if (!t || t.kind === "file") { explorerMessage("请先选择一个终端标签，再用 Alt+点击插入路径。"); return; }
  t.term.paste(p + " ");
  t.term.focus();
}

// ---- system monitor (top-like; polls only while the window is visible) ----
interface Proc { pid: number; name: string; cpu: number; mem: number }
interface Snapshot {
  cores: number[]; mem_used: number; mem_total: number; swap_used: number; swap_total: number;
  uptime: number; proc_count: number; procs: Proc[];
}
let procs: Proc[] = [];
let selPid: number | null = null;
let armed = false;
let sort: "cpu" | "mem" = "cpu";

const gb = (b: number) => (b / 1073741824).toFixed(1);
const color = (p: number) => (p > 85 ? "#e06c75" : p > 60 ? "#e5c07b" : "#4caf50");

function meter(cls: string, label: string, pct: number, text: string) {
  const d = document.createElement("div");
  d.className = "m " + cls;
  const l = document.createElement("span"); l.className = "l"; l.textContent = label;
  const bar = document.createElement("span"); bar.className = "bar";
  const fill = document.createElement("i");
  fill.style.width = Math.min(100, pct) + "%";
  fill.style.background = color(pct);
  bar.append(fill);
  const v = document.createElement("span"); v.className = "v"; v.textContent = text;
  d.append(l, bar, v);
  return d;
}

function renderSnapshot(s: Snapshot) {
  const d = Math.floor(s.uptime / 86400), hh = Math.floor((s.uptime % 86400) / 3600), mm = Math.floor((s.uptime % 3600) / 60);
  $("uptime").textContent = `运行 ${d ? d + "d " : ""}${hh}h${mm}m · ${s.cores.length} 核`;
  const avg = s.cores.reduce((x, y) => x + y, 0) / Math.max(1, s.cores.length);
  $("cores").style.setProperty("--cols", String(s.cores.length > 16 ? 3 : 2));
  $("cores").replaceChildren(...s.cores.map((c, i) => meter("cpu", String(i), c, c.toFixed(0) + "%")));
  const memPct = (s.mem_used / s.mem_total) * 100;
  const swapPct = s.swap_total ? (s.swap_used / s.swap_total) * 100 : 0;
  $("meters").replaceChildren(
    meter("cpu", "CPU", avg, avg.toFixed(0) + "%"),
    meter("", "内存", memPct, `${gb(s.mem_used)}/${gb(s.mem_total)}G`),
    meter("", "交换", swapPct, `${gb(s.swap_used)}/${gb(s.swap_total)}G`),
  );
  $("proc-count").textContent = `(${s.proc_count})`;
  procs = s.procs;
  const ul = $("procs");
  ul.replaceChildren();
  for (const p of procs) {
    const li = document.createElement("li");
    li.className = "row" + (p.pid === selPid ? " sel" : "");
    const cell = (t: string, c = "") => { const e = document.createElement("span"); e.className = c; e.textContent = t; return e; };
    li.append(cell(String(p.pid), "n"), cell(p.name), cell(p.cpu.toFixed(1), "n"), cell((p.mem / 1048576).toFixed(0) + "M", "n"));
    li.onclick = () => { selPid = p.pid; armed = false; $("proc-msg").textContent = ""; void refresh(); };
    ul.append(li);
  }
}
async function refresh() {
  if (document.visibilityState !== "visible") return;
  renderSnapshot(await invoke<Snapshot>("sys_snapshot", { sort, limit: 20 }));
}
for (const k of ["cpu", "mem"] as const) {
  $("s-" + k).onclick = () => {
    sort = k;
    $("s-cpu").classList.toggle("on", k === "cpu");
    $("s-mem").classList.toggle("on", k === "mem");
    void refresh();
  };
}
// Ending a process requires a second press; ignore editing controls and dialogs.
window.addEventListener("keydown", async (e) => {
  if (e.repeat || !matchesShortcut(e, "killProcess") || document.querySelector("dialog[open]") || selPid === null || (e.target instanceof Element && e.target.closest("input, textarea, [contenteditable], dialog"))) return;
  const p = procs.find((x) => x.pid === selPid);
  if (!p) return;
  e.preventDefault();
  if (!armed) { armed = true; $("proc-msg").textContent = `再按 ${shortcutLabel("killProcess")} 确认结束 ${p.name} (${p.pid})`; return; }
  armed = false;
  const ok = await invoke<boolean>("kill_process", { pid: p.pid });
  $("proc-msg").textContent = ok ? `已结束 ${p.pid}` : `无法结束 ${p.pid}`;
  void refresh();
});
setInterval(refresh, 2000);
void refresh();

async function prepareToClose() {
  if (closing) return false;
  closing = true;
  try { return await confirmClose(projects.flatMap(p => fileEditors(p.tabs))); }
  finally { closing = false; }
}
void getCurrentWindow().onCloseRequested(async event => {
  event.preventDefault();
  if (await prepareToClose()) await getCurrentWindow().destroy();
}).catch(error => explorerMessage(`无法启用窗口关闭保护：${error}`, true));
window.addEventListener("beforeunload", event => {
  if (projects.some(p => fileEditors(p.tabs).some(editor => editor.dirty || editor.busy))) event.preventDefault();
});
initDashboard(async () => {
  for (const p of projects) {
    for (const tab of [...p.tabs]) if (tab.kind !== "file") {
      await tab.ready.catch(() => {});
      await invoke("pty_close", { id: tab.id });
    }
  }
}, prepareToClose);
void start();
