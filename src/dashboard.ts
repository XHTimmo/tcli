import { invoke } from "@tauri-apps/api/core";
import { getVersion } from "@tauri-apps/api/app";
import { ask } from "@tauri-apps/plugin-dialog";
import { check, type Update } from "@tauri-apps/plugin-updater";

interface Route {
  id: number; time: string; agent: string; session: string; folder: string;
  model: string; provider: string; served: string; done: boolean; status: number;
  bytes: number; ms: number; ttft: number;
  order: { id: string; name: string; model: string }[];
}
const $ = (id: string) => document.getElementById(id)!;
function text(tag: string, value: string, cls = "") {
  const el = document.createElement(tag);
  el.textContent = value;
  el.className = cls;
  return el;
}
const age = (time: string) => {
  const seconds = Math.max(0, Math.floor((Date.now() - Date.parse(time)) / 1000));
  return seconds < 60 ? `${seconds} 秒前` : seconds < 3600 ? `${Math.floor(seconds / 60)} 分钟前` : `${Math.floor(seconds / 3600)} 小时前`;
};

const BIRD = `<svg viewBox="0 0 32 20" aria-hidden="true"><path class="wing" d="M14 9 L6 1 L20 6 Z" fill="#2b2f38"/><path d="M4 11 Q12 5 22 8 L29 7 L24 11 Q20 17 10 16 L1 19 Z" fill="#e8eaee"/><path d="M1 19 L10 16 L14 12 Q8 12 4 11 Z" fill="#2b2f38"/><path d="M22 8 L29 7 L24 11 Z" fill="#2b2f38"/><circle cx="23" cy="8.6" r="1" fill="#fff"/></svg>`;
function flow(agent: string) {
  const el = text("div", "", "route-flow");
  const node = (cls: string, label: string) => text("span", label, `flow-node ${cls}`);
  const link = text("span", "", "flow-link");
  const bird = text("span", "", "flow-bird");
  bird.innerHTML = BIRD;
  link.append(bird);
  el.append(node("flow-pi", agent), link, node("flow-magpie", "magpie"), text("span", "", "flow-link"), node("flow-provider", ""));
  return el;
}

export function initDashboard(closeTerminals: () => Promise<void>) {
  let fetching = false;
  let updateBusy = false;
  let pending: Update | null = null;
  let routes: Route[] = [];
  const cardCache = new Map<number, HTMLElement>();
  function render() {
    const cards = routes.map((r) => {
      const agent = r.agent === "pi" ? "Pi" : r.agent || "客户端";
      let card = cardCache.get(r.id);
      if (!card) {
        card = text("li", "", "route-card");
        const head = text("div", "", "route-head");
        head.append(text("span", "", "route-chain"), text("span", ""));
        card.append(head, flow(agent), text("div", "", "route-model"), text("div", "", "route-detail dim"), text("div", "", "route-folder dim"));
        cardCache.set(r.id, card);
      }
      const [head, fl, modelEl, detail, folder] = Array.from(card.children) as HTMLElement[];
      const provider = r.order.find((p) => p.id === r.provider);
      const model = r.served || provider?.model || r.model;
      const failed = r.status >= 400;
      const state = failed ? `失败 ${r.status}` : r.done ? "已完成" : r.bytes ? "回答中…" : "连接中…";
      head.children[0].textContent = `${agent} → magpie`;
      head.children[1].textContent = state;
      head.children[1].className = failed ? "route-error" : r.done ? "dim" : "route-live";
      fl.className = `route-flow ${failed ? "failed" : r.done ? "done" : r.bytes ? "live answering" : "live"}`;
      const providerName = provider?.name || r.provider || "等待路由";
      fl.querySelector(".flow-provider")!.textContent = providerName;
      modelEl.textContent = model;
      modelEl.title = model;
      const details = [`${(r.bytes / 1024).toFixed(1)} KiB`, age(r.time)];
      if (r.done && r.ms) details.push(`${(r.ms / 1000).toFixed(1)}s`);
      if (r.ttft) details.push(`首字 ${(r.ttft / 1000).toFixed(1)}s`);
      detail.textContent = details.join(" · ");
      folder.textContent = r.folder;
      folder.title = `${r.folder}\n会话 ${r.session}`;
      folder.hidden = !r.folder;
      return card;
    });
    const live = new Set(routes.map((r) => r.id));
    for (const id of cardCache.keys()) if (!live.has(id)) cardCache.delete(id);
    const list = $("routes");
    if (!cards.length) { list.replaceChildren(text("li", "暂无路由请求", "dim")); return; }
    // reconcile in place so running animations are not restarted by re-attaching nodes
    cards.forEach((card, i) => { if (list.children[i] !== card) list.insertBefore(card, list.children[i] ?? null); });
    while (list.children.length > cards.length) list.lastElementChild!.remove();
  }
  async function refreshRoutes() {
    if (fetching || document.visibilityState !== "visible") return;
    fetching = true;
    try {
      routes = await invoke<Route[]>("magpie_routes");
      $("magpie-status").textContent = "在线 · 127.0.0.1:3425";
      render();
    } catch (error) {
      $("magpie-status").textContent = "未连接";
      $("magpie-status").title = String(error);
      $("routes").replaceChildren(text("li", "无法连接 Magpie，等待重连…", "dim"));
    } finally { fetching = false; }
  }
  async function refreshUpdate() {
    if (updateBusy || document.visibilityState !== "visible") return;
    const label = $("build-mode");
    const button = $("update-app") as HTMLButtonElement;
    try {
      const version = await getVersion();
      label.textContent = `v${version}${import.meta.env.DEV ? " · 开发版本" : ""}`;
      if (import.meta.env.DEV) return;
      pending = await check();
      button.hidden = !pending;
      if (pending) label.textContent = `v${version} → v${pending.version}`;
    } catch (error) { label.title = `检查更新失败：${error}`; }
  }
  $("update-app").onclick = async () => {
    if (updateBusy || !pending) return;
    if (!(await ask(`更新到 v${pending.version} 会重启 tcli，结束所有已打开的终端。工程列表会保留，但终端中的运行任务不会恢复。现在更新？`, { title: "更新 tcli", kind: "warning" }))) return;
    updateBusy = true;
    const button = $("update-app") as HTMLButtonElement;
    button.disabled = true;
    button.textContent = "正在下载…";
    try {
      await pending.download();
      button.textContent = "正在安装…";
      await closeTerminals();
      await pending.install();
    } catch (error) {
      $("build-mode").textContent = `更新失败：${error}`;
      button.disabled = false;
      button.textContent = "更新并重启";
      updateBusy = false;
    }
  };
  setInterval(() => void refreshRoutes(), 2000);
  setInterval(() => void refreshUpdate(), 30 * 60 * 1000);
  document.addEventListener("visibilitychange", () => void refreshRoutes());
  void refreshRoutes();
  void refreshUpdate();
}
