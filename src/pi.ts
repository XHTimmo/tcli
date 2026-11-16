import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";

const storageKey = "tcli.pi-path";
let pending: Promise<string | null> | null = null;
const savedPath = () => localStorage.getItem(storageKey) || "";

export async function ensurePi(): Promise<string | null> {
  if (pending) return pending;
  try { return await invoke<string>("detect_pi", { path: savedPath() }); }
  catch (error) { return configurePi(String(error)); }
}

export function configurePi(initialMessage = "选择 pi 启动文件，留空则自动检测。设置会用于之后新建的 pi 标签。"): Promise<string | null> {
  if (pending) return pending;
  pending = new Promise(resolve => {
    let result: string | null = null;
    let busy = false;
    const dialog = document.createElement("dialog");
    dialog.className = "save-dialog pi-dialog";
    const title = document.createElement("h3");
    title.textContent = "配置 pi";
    const help = document.createElement("p");
    help.textContent = "可选择本机的 pi 启动文件（如 pi.cmd、pi.exe），或一键安装。安装会从 pi.dev 下载并运行官方安装脚本；如需安装 Node.js 等依赖，请按安装窗口中的提示操作。";
    const input = document.createElement("input");
    input.className = "pi-path";
    input.placeholder = "自动检测，或输入 pi 启动文件的完整路径";
    input.setAttribute("aria-label", "pi 启动文件路径");
    input.value = savedPath();
    const message = document.createElement("p");
    message.setAttribute("role", "status");
    message.textContent = initialMessage;
    const actions = document.createElement("div");
    actions.className = "dialog-actions";
    const controls: HTMLButtonElement[] = [];
    const run = async (work: () => Promise<void>) => {
      if (busy) return;
      busy = true;
      input.disabled = true;
      controls.forEach(button => { button.disabled = true; });
      message.className = "";
      try { await work(); }
      catch (error) { message.textContent = String(error); message.className = "error"; }
      finally {
        busy = false;
        input.disabled = false;
        controls.forEach(button => { button.disabled = false; });
      }
    };
    const button = (text: string, action: () => void) => {
      const el = document.createElement("button");
      el.textContent = text;
      el.onclick = action;
      controls.push(el);
      actions.append(el);
      return el;
    };
    const finish = (path: string, preference: string) => {
      localStorage.setItem(storageKey, preference);
      result = path;
      dialog.close();
    };
    button("选择文件…", () => void run(async () => {
      const path = await open({ multiple: false, directory: false, title: "选择 pi 启动文件" });
      if (typeof path === "string") {
        input.value = path;
        message.textContent = "已选择路径，点击“检测并保存”确认。";
      }
    }));
    button("一键安装", () => void run(async () => {
      message.textContent = "正在安装，请在新打开的安装窗口中完成操作。完成后会自动检测，无需重启 tcli。";
      const path = await invoke<string>("install_pi");
      finish(path, path);
    }));
    button("取消", () => dialog.close());
    button("检测并保存", () => void run(async () => {
      message.textContent = "正在检测 pi…";
      const preference = input.value.trim();
      const path = await invoke<string>("detect_pi", { path: preference });
      finish(path, preference);
    })).className = "primary";
    dialog.oncancel = event => { if (busy) event.preventDefault(); };
    dialog.onclose = () => { dialog.remove(); pending = null; resolve(result); };
    dialog.append(title, help, input, message, actions);
    document.body.append(dialog);
    dialog.showModal();
  });
  return pending;
}
