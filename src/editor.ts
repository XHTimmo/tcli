import { invoke } from "@tauri-apps/api/core";
import { ask } from "@tauri-apps/plugin-dialog";
import { basicSetup } from "codemirror";
import { Compartment, EditorState } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { indentWithTab } from "@codemirror/commands";
import { languages } from "@codemirror/language-data";
import { oneDark } from "@codemirror/theme-one-dark";

export interface FileDocument {
  path: string; kind: "text" | "image"; content: string; revision: string; format: string;
}
const element = <K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text = "") => {
  const el = document.createElement(tag);
  el.className = cls;
  el.textContent = text;
  return el;
};
export const fileName = (path: string) => path.replace(/\\/g, "/").split("/").pop() || path;

export class FileEditor {
  readonly el = element("div", "pane file-pane hidden");
  readonly path: string;
  private doc: FileDocument;
  private view?: EditorView;
  private savedContent: string;
  private language = new Compartment();
  private editable = new Compartment();
  private saveButton = element("button", "", "保存");
  private reloadButton = element("button", "", "重新读取");
  private status = element("span", "editor-status");
  private position = element("span", "editor-position");
  private message = element("div", "editor-message");
  private body = element("div", "editor-body");
  private saving: Promise<boolean> | null = null;
  private loading = false;
  private disposed = false;

  constructor(doc: FileDocument, private changed: () => void) {
    this.doc = doc;
    this.el.tabIndex = -1;
    this.path = doc.path;
    this.savedContent = doc.content;
    const toolbar = element("div", "editor-toolbar");
    const path = element("span", "editor-path", doc.path.replace(/^\\\\\?\\/, ""));
    path.title = doc.path;
    this.saveButton.title = "保存 (Ctrl+S)";
    this.saveButton.onclick = () => void this.save();
    this.reloadButton.onclick = () => void this.reload();
    toolbar.append(path, this.reloadButton, this.saveButton);
    this.message.setAttribute("role", "status");
    this.message.hidden = true;
    const footer = element("div", "editor-footer");
    footer.append(this.status, this.position);
    this.el.append(toolbar, this.message, this.body, footer);
    this.mount();
  }

  get dirty() { return !!this.view && this.view.state.doc.toString() !== this.savedContent; }
  get busy() { return !!this.saving || this.loading; }

  private notify(message = "", error = false) {
    this.message.textContent = message;
    this.message.hidden = !message;
    this.message.classList.toggle("error", error);
  }

  private update() {
    this.saveButton.hidden = this.doc.kind !== "text";
    this.saveButton.disabled = !this.dirty || this.busy;
    this.saveButton.textContent = this.saving ? "保存中…" : "保存";
    this.reloadButton.disabled = this.busy;
    this.status.textContent = `${this.doc.format}${this.dirty ? " · 未保存" : ""}`;
    if (this.view) {
      const pos = this.view.state.selection.main.head;
      const line = this.view.state.doc.lineAt(pos);
      this.position.textContent = `行 ${line.number}，列 ${pos - line.from + 1}`;
    }
    this.changed();
  }

  private mount() {
    this.view?.destroy();
    this.view = undefined;
    this.body.replaceChildren();
    this.position.textContent = "";
    if (this.doc.kind === "image") {
      const image = element("img", "file-image");
      image.alt = fileName(this.path);
      image.onload = () => { this.position.textContent = `${image.naturalWidth} × ${image.naturalHeight}`; };
      image.onerror = () => this.notify("图片无法解码，文件可能损坏或格式不受支持。", true);
      image.src = this.doc.content;
      this.body.append(image);
    } else {
      this.view = new EditorView({
        parent: this.body,
        state: EditorState.create({
          doc: this.doc.content,
          extensions: [
            basicSetup, oneDark, this.language.of([]),
            this.editable.of([]),
            EditorView.contentAttributes.of({ "aria-label": `编辑 ${fileName(this.path)}` }),
            keymap.of([{ key: "Mod-s", run: () => { void this.save(); return true; } }, indentWithTab]),
            EditorView.updateListener.of(update => {
              if (update.docChanged) this.notify();
              if (update.docChanged || update.selectionSet) this.update();
            }),
          ],
        }),
      });
      const view = this.view;
      const language = languages.find(lang => lang.filename?.test(fileName(this.path)))
        || languages.find(lang => lang.extensions.includes(fileName(this.path).split(".").pop()?.toLowerCase() || ""));
      if (language) void language.load().then(support => {
        if (!this.disposed && this.view === view) view.dispatch({ effects: this.language.reconfigure(support) });
      }).catch(() => { /* Plain text editing remains available if a language cannot load. */ });
    }
    this.update();
  }

  focus() {
    if (this.view) { this.view.requestMeasure(); this.view.focus(); }
    else this.el.focus();
  }

  async save(): Promise<boolean> {
    if (this.saving) return this.saving;
    if (this.loading) return false;
    if (!this.view || !this.dirty) return true;
    const content = this.view.state.doc.toString();
    this.saving = (async () => {
      try {
        const revision = await invoke<string>("save_file", { path: this.path, content, revision: this.doc.revision });
        this.doc.revision = revision;
        this.savedContent = content;
        this.notify("已保存");
        return true;
      } catch (error) {
        this.notify(`保存失败：${error}`, true);
        return false;
      }
    })();
    this.update();
    try { return await this.saving; }
    finally { this.saving = null; this.update(); }
  }

  private async reload() {
    if (this.busy) return;
    if (this.dirty && !(await ask("重新读取会丢弃此文件未保存的修改，继续？", { title: fileName(this.path), kind: "warning" }))) return;
    if (this.disposed || this.busy) return;
    this.loading = true;
    this.view?.dispatch({ effects: this.editable.reconfigure([EditorState.readOnly.of(true), EditorView.editable.of(false)]) });
    this.update();
    try {
      const doc = await invoke<FileDocument>("read_file", { path: this.path });
      if (this.disposed) return;
      this.doc = doc;
      this.savedContent = doc.content;
      this.mount();
      this.notify("已重新读取");
    } catch (error) { this.notify(`读取失败：${error}`, true); }
    finally {
      this.loading = false;
      if (!this.disposed) {
        this.view?.dispatch({ effects: this.editable.reconfigure([]) });
        this.update();
      }
    }
  }

  dispose() { this.disposed = true; this.view?.destroy(); this.el.remove(); }
}

/** Resolve unsaved edits before a tab, project, window, or update closes the editors. */
export async function confirmClose(editors: FileEditor[]): Promise<boolean> {
  if (editors.some(editor => editor.busy)) return false;
  const dirty = editors.filter(editor => editor.dirty);
  if (!dirty.length) return true;
  const dialog = element("dialog", "save-dialog");
  const heading = element("h3", "", "保存文件修改？");
  const description = element("p", "", `${dirty.map(editor => fileName(editor.path)).join("、")} 有未保存的修改。`);
  const error = element("p", "error");
  const buttons = element("div", "dialog-actions");
  const cancel = element("button", "", "取消");
  const discard = element("button", "", "不保存");
  const save = element("button", "primary", "全部保存");
  buttons.append(cancel, discard, save);
  dialog.append(heading, description, error, buttons);
  document.body.append(dialog);
  return new Promise(resolve => {
    const finish = (result: boolean) => { dialog.close(); dialog.remove(); resolve(result); };
    cancel.onclick = () => finish(false);
    discard.onclick = () => finish(true);
    dialog.oncancel = event => { event.preventDefault(); if (!save.disabled) finish(false); };
    save.onclick = async () => {
      save.disabled = discard.disabled = cancel.disabled = true;
      for (const editor of dirty) {
        if (!(await editor.save())) {
          error.textContent = `无法保存 ${fileName(editor.path)}。请取消关闭，并查看编辑器中的错误提示。`;
          save.disabled = discard.disabled = cancel.disabled = false;
          return;
        }
      }
      finish(true);
    };
    dialog.showModal();
    save.focus();
  });
}
