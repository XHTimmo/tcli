import type { Terminal } from "@xterm/xterm";
import { readText, writeText } from "@tauri-apps/plugin-clipboard-manager";

/** Keep clipboard gestures out of both the WebView and the application's mouse protocol. */
export function attachTerminalInput(term: Terminal, el: HTMLElement, kind: "pi" | "shell", report: (message: string) => void) {
  const events = new AbortController();
  let disposed = false;
  // Pi may use OSC 52 when it inherits WT_SESSION or runs through SSH.
  // Support writes only; clipboard queries must never expose local clipboard contents.
  const clipboard = term.parser.registerOscHandler(52, data => {
    const separator = data.indexOf(";");
    if (separator < 0) return true;
    const encoded = data.slice(separator + 1);
    if (encoded === "?" || encoded.length > 100_000) return true;
    try {
      const text = new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(atob(encoded), c => c.charCodeAt(0)));
      void writeText(text).catch(error => report(`无法复制 pi 输出：${error}`));
    } catch (error) { report(`无法解析 pi 剪贴板内容：${error}`); }
    return true;
  });
  const copy = async () => {
    const text = term.getSelection();
    if (!text) return;
    try { await writeText(text); }
    catch (error) { report(`无法复制终端选区：${error}`); }
  };
  const paste = async () => {
    try {
      const text = await readText();
      if (disposed || !el.isConnected) return;
      // Deliver to the originating terminal, but never steal focus from another tab/dialog.
      if (!el.classList.contains("hidden") && !document.querySelector("dialog[open]")) term.focus();
      // xterm wraps multiline text in bracketed paste when the application requests it.
      if (text) term.paste(text);
    } catch (error) { report(`无法粘贴剪贴板文本：${error}`); }
  };
  const consume = (event: Event) => {
    event.preventDefault();
    event.stopImmediatePropagation();
  };
  el.addEventListener("keydown", event => {
    if (event.isComposing || event.keyCode === 229 || event.metaKey) return;
    const key = event.key.toLowerCase();
    if (kind === "pi" && key === "enter" && (event.shiftKey || event.ctrlKey || event.altKey)) {
      consume(event);
      const modifier = 1 + Number(event.shiftKey) + 2 * Number(event.altKey) + 4 * Number(event.ctrlKey);
      term.input(`\x1b[13;${modifier}u`, true);
      return;
    }
    if (event.altKey) return;
    if (event.ctrlKey && (key === "c" && (event.shiftKey || term.hasSelection()) || key === "insert" && !event.shiftKey)) {
      consume(event);
      void copy();
    } else if (event.ctrlKey && key === "v" || event.shiftKey && !event.ctrlKey && key === "insert") {
      consume(event);
      // Pi reads images and text from the native clipboard itself on Ctrl+V.
      if (kind === "pi" && event.ctrlKey && !event.shiftKey) term.input("\x16", true);
      else void paste();
    } else if (kind === "pi" && event.ctrlKey && (event.shiftKey && /^[a-z]$/.test(key) || key === "-")) {
      // Legacy xterm key encoding collapses Ctrl+Shift+letter into Ctrl+letter.
      consume(event);
      term.input(`\x1b[${key.charCodeAt(0)};${event.shiftKey ? 6 : 5}u`, true);
    }
  }, { capture: true, signal: events.signal });
  for (const name of ["mousedown", "mouseup"] as const) {
    el.addEventListener(name, event => {
      if (event.button === 2) consume(event);
    }, { capture: true, signal: events.signal });
  }
  el.addEventListener("contextmenu", event => {
    consume(event);
    void paste();
  }, { capture: true, signal: events.signal });
  return () => { disposed = true; events.abort(); clipboard.dispose(); };
}
