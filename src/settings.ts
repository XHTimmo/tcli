export const shortcutActions = [
  { id: "openProject", label: "打开工程", defaultKey: "Ctrl+Shift+O" },
  { id: "newPi", label: "新建 pi 终端", defaultKey: "Ctrl+Shift+T" },
  { id: "newShell", label: "新建 shell 终端", defaultKey: "" },
  { id: "closeTab", label: "关闭当前标签", defaultKey: "Ctrl+Shift+W" },
  { id: "nextTab", label: "切换到下一个标签", defaultKey: "Ctrl+Shift+Tab" },
  { id: "saveFile", label: "保存文件", defaultKey: "Ctrl+S" },
  { id: "openExplorer", label: "在资源管理器中打开当前目录", defaultKey: "" },
  { id: "settings", label: "打开设置", defaultKey: "Ctrl+," },
  { id: "killProcess", label: "结束选中的进程", defaultKey: "K" },
] as const;
export type ShortcutAction = typeof shortcutActions[number]["id"];
type Bindings = Record<ShortcutAction, string>;
const storageKey = "tcli.shortcuts";
const defaults = () => Object.fromEntries(shortcutActions.map(a => [a.id, a.defaultKey])) as Bindings;
let bindings = defaults();
try {
  const saved = JSON.parse(localStorage.getItem(storageKey) || "{}");
  if (saved && typeof saved === "object") {
    for (const action of shortcutActions) {
      if (typeof saved[action.id] === "string") bindings[action.id] = saved[action.id];
    }
  }
} catch { /* Keep defaults if settings are unavailable. */ }

function keyCombination(event: KeyboardEvent) {
  if (["Control", "Shift", "Alt", "Meta", "Dead", "Process", "Unidentified"].includes(event.key) || event.isComposing) return "";
  const key = event.key === " " ? "Space" : event.key.length === 1 ? event.key.toUpperCase() : event.key;
  return [event.ctrlKey && "Ctrl", event.altKey && "Alt", event.shiftKey && "Shift", event.metaKey && "Meta", key].filter(Boolean).join("+");
}
export function shortcutLabel(action: ShortcutAction) { return bindings[action]; }
export function matchesShortcut(event: KeyboardEvent, action: ShortcutAction) {
  return !!bindings[action] && !event.isComposing && keyCombination(event) === bindings[action];
}

export function openSettings() {
  if (document.querySelector(".settings-dialog")) return;
  const draft = { ...bindings };
  const dialog = document.createElement("dialog");
  dialog.className = "save-dialog settings-dialog";
  const title = document.createElement("h3");
  title.textContent = "设置 · 快捷键";
  const help = document.createElement("p");
  help.className = "dim";
  help.textContent = "点击输入框后按下快捷键。Backspace / Delete 清除，Esc 取消设置。除结束进程外，快捷键需包含 Ctrl、Alt 或 Meta。";
  const form = document.createElement("div");
  form.className = "shortcut-fields";
  const inputs = new Map<ShortcutAction, HTMLInputElement>();
  const message = document.createElement("p");
  message.className = "error";
  message.setAttribute("role", "status");
  for (const action of shortcutActions) {
    const label = document.createElement("label");
    label.textContent = action.label;
    const input = document.createElement("input");
    input.readOnly = true;
    input.value = draft[action.id];
    input.placeholder = "未设置";
    input.setAttribute("aria-label", action.label);
    input.onkeydown = event => {
      if (event.key === "Escape" || event.key === "Tab" && !event.ctrlKey && !event.altKey && !event.metaKey) return;
      event.preventDefault();
      event.stopPropagation();
      message.textContent = "";
      if (["Backspace", "Delete"].includes(event.key) && !event.ctrlKey && !event.altKey && !event.metaKey && !event.shiftKey) {
        draft[action.id] = input.value = "";
        return;
      }
      const combination = keyCombination(event);
      if (!combination) return;
      if (action.id !== "killProcess" && !event.ctrlKey && !event.altKey && !event.metaKey) {
        message.textContent = "请包含 Ctrl、Alt 或 Meta，避免影响终端和编辑器输入。";
        return;
      }
      draft[action.id] = input.value = combination;
    };
    inputs.set(action.id, input);
    label.append(input);
    form.append(label);
  }
  const actions = document.createElement("div");
  actions.className = "dialog-actions";
  const button = (text: string, run: () => void) => {
    const el = document.createElement("button");
    el.textContent = text;
    el.onclick = run;
    actions.append(el);
    return el;
  };
  button("恢复默认", () => {
    Object.assign(draft, defaults());
    inputs.forEach((input, id) => { input.value = draft[id]; });
    message.textContent = "";
  });
  button("取消", () => dialog.close());
  button("保存", () => {
    const used = new Map<string, string>();
    for (const action of shortcutActions) {
      const key = draft[action.id];
      if (key && used.has(key)) {
        message.textContent = `${action.label}与${used.get(key)}使用了相同的快捷键：${key}`;
        return;
      }
      if (key) used.set(key, action.label);
    }
    try { localStorage.setItem(storageKey, JSON.stringify(draft)); }
    catch { message.textContent = "无法保存设置，请检查本机存储是否可用。"; return; }
    bindings = { ...draft };
    window.dispatchEvent(new Event("shortcuts-changed"));
    dialog.close();
  }).className = "primary";
  dialog.append(title, help, form, message, actions);
  dialog.onclose = () => dialog.remove();
  document.body.append(dialog);
  dialog.showModal();
}
