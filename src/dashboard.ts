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
type FlowState = "routing" | "waiting" | "answering" | "done" | "failed";
function flow(agent: string) {
  const el = text("div", "", "route-flow");
  const node = (cls: string, label: string) => text("span", label, `flow-node ${cls}`);
  const link = (cls: string) => {
    const track = text("span", "", `flow-link ${cls}`);
    track.setAttribute("aria-hidden", "true");
    const bird = text("span", "", "flow-bird");
    bird.innerHTML = BIRD;
    track.append(text("span", "", "flow-track outbound"), text("span", "", "flow-track inbound"), bird);
    return track;
  };
  el.append(node("flow-pi", agent), link("flow-request"), node("flow-magpie", "magpie"), link("flow-upstream"), node("flow-provider", ""));
  return el;
}
function stages() {
  const el = text("div", "", "route-stages");
  for (const [state, label] of [["routing", "路由"], ["waiting", "等待首字"], ["answering", "接收响应"], ["done", "完成"]]) {
    const step = text("span", label);
    step.dataset.step = state;
    el.append(step);
  }
  return el;
}

export function initDashboard(closeTerminals: () => Promise<void>, prepareToClose: () => Promise<boolean> = async () => true) {
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
        card.append(head, flow(agent), stages(), text("div", "", "route-model"), text("div", "", "route-detail dim"), text("div", "", "route-folder dim"), text("div", "", "route-candidates dim"));
        cardCache.set(r.id, card);
      }
      const [head, fl, steps, modelEl, detail, folder, candidates] = Array.from(card.children) as HTMLElement[];
      const provider = r.order.find((p) => p.id === r.provider);
      const model = r.served || provider?.model || r.model;
      const state: FlowState = r.status >= 400 ? "failed" : r.done ? "done" : r.bytes > 0 ? "answering" : r.provider ? "waiting" : "routing";
      const labels: Record<FlowState, string> = { routing: "选择路由…", waiting: "等待首字…", answering: "响应回传中…", done: "已完成", failed: `失败 ${r.status}` };
      if (card.dataset.state !== state) card.dataset.state = state;
      head.children[0].textContent = `${agent} → magpie`;
      head.children[1].textContent = labels[state];
      head.children[1].className = state === "failed" ? "route-error" : state === "done" ? "dim" : "route-live";
      const providerName = provider?.name || r.provider || "等待路由";
      const agentNode = fl.querySelector<HTMLElement>(".flow-pi")!;
      agentNode.textContent = agent;
      agentNode.title = agent;
      const providerNode = fl.querySelector<HTMLElement>(".flow-provider")!;
      providerNode.textContent = providerName;
      providerNode.title = providerName;
      fl.setAttribute("aria-label", `${agent} → magpie → ${providerName}，${labels[state]}`);
      const activeStep = ["routing", "waiting", "answering", "done"].indexOf(state);
      Array.from(steps.children).forEach((step, i) => {
        step.className = i === activeStep ? "current" : i < activeStep ? "passed" : "";
        if (i === activeStep) step.setAttribute("aria-current", "step");
        else step.removeAttribute("aria-current");
      });
      steps.lastElementChild!.textContent = state === "failed" ? "失败" : "完成";
      if (state === "failed") steps.lastElementChild!.className = "step-error";
      modelEl.textContent = model;
      modelEl.title = model;
      const details = [`${(r.bytes / 1024).toFixed(1)} KiB`, age(r.time)];
      if (r.done && r.ms) details.push(`${(r.ms / 1000).toFixed(1)}s`);
      if (r.ttft) details.push(`首字 ${(r.ttft / 1000).toFixed(1)}s`);
      detail.textContent = details.join(" · ");
      folder.textContent = r.folder;
      folder.title = `${r.folder}\n会话 ${r.session}`;
      folder.hidden = !r.folder;
      candidates.hidden = r.order.length < 2;
      candidates.textContent = r.order.map((p, i) => `${i + 1}. ${p.name || p.id}${p.id === r.provider ? "（当前）" : ""}`).join(" → ");
      candidates.title = `候选路由顺序：${candidates.textContent}`;
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
      $("magpie-status").title = "";
      $("routes").classList.remove("offline");
      render();
    } catch (error) {
      $("magpie-status").textContent = "未连接 · 等待重连";
      $("magpie-status").title = String(error);
      $("routes").classList.add("offline");
      if (!routes.length) $("routes").replaceChildren(text("li", "无法连接 Magpie，等待重连…", "dim"));
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
      if (!(await prepareToClose())) {
        button.disabled = false;
        button.textContent = "更新并重启";
        updateBusy = false;
        return;
      }
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
  document.addEventListener("visibilitychange", () => {
    $("routes").classList.toggle("paused", document.visibilityState !== "visible");
    void refreshRoutes();
  });
  void refreshRoutes();
  void refreshUpdate();
}
