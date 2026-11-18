import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import assert from "node:assert/strict";
import { test } from "node:test";

let copied = [], readClipboard = async () => "第一行\n第二行";
globalThis.clipboardMock = {
  writeText: async text => { copied.push(text); },
  readText: () => readClipboard(),
};
globalThis.document = { querySelector: () => null };
const source = readFileSync(new URL("../src/terminal-input.ts", import.meta.url), "utf8")
  .replace('import { readText, writeText } from "@tauri-apps/plugin-clipboard-manager";',
    'const { readText, writeText } = globalThis.clipboardMock;');
const { attachTerminalInput } = await import("data:text/javascript;base64," + Buffer.from(stripTypeScriptTypes(source)).toString("base64"));
const tick = () => new Promise(resolve => setImmediate(resolve));

function setup(kind = "pi") {
  const el = new EventTarget();
  el.isConnected = true;
  el.hiddenTab = false;
  el.classList = { contains: () => el.hiddenTab };
  const inputs = [], pastes = [], errors = [];
  let selection = "", osc, released = false, focusCount = 0;
  const term = {
    getSelection: () => selection, hasSelection: () => !!selection,
    focus: () => { focusCount++; }, input: text => inputs.push(text), paste: text => pastes.push(text),
    parser: { registerOscHandler: (id, handler) => {
      assert.equal(id, 52); osc = handler;
      return { dispose: () => { released = true; } };
    } },
  };
  const dispose = attachTerminalInput(term, el, kind, message => errors.push(message));
  const event = (type, fields = {}) => {
    const e = new Event(type, { cancelable: true });
    Object.assign(e, { ctrlKey: false, shiftKey: false, altKey: false, metaKey: false, ...fields });
    el.dispatchEvent(e);
    return e.defaultPrevented;
  };
  return { el, inputs, pastes, errors, dispose, event,
    key: (key, fields) => event("keydown", { key, ...fields }),
    select: text => { selection = text; }, osc: text => osc(text),
    released: () => released, focusCount: () => focusCount };
}

test("clipboard gestures preserve pi shortcuts and multiline text", async () => {
  const pi = setup();
  assert.equal(pi.key("c", { ctrlKey: true }), false);
  pi.select("中文选区");
  assert.equal(pi.key("c", { ctrlKey: true }), true);
  await tick();
  assert.equal(copied.at(-1), "中文选区");
  pi.key("v", { ctrlKey: true });
  assert.deepEqual(pi.inputs, ["\x16"]);
  pi.key("V", { ctrlKey: true, shiftKey: true });
  await tick();
  assert.deepEqual(pi.pastes, ["第一行\n第二行"]);
  assert.equal(pi.event("mousedown", { button: 2 }), true);
  assert.equal(pi.event("mouseup", { button: 2 }), true);
  assert.equal(pi.pastes.length, 1);
  assert.equal(pi.event("contextmenu"), true);
  await tick();
  assert.equal(pi.pastes.length, 2);
  pi.dispose();
  const shell = setup("shell");
  shell.key("v", { ctrlKey: true });
  await tick();
  assert.deepEqual(shell.pastes, ["第一行\n第二行"]);
  assert.equal(shell.key("Enter", { shiftKey: true }), false);
  shell.dispose();
});

test("modified pi keys stay distinct and IME confirmation is untouched", () => {
  const pi = setup();
  pi.key("Enter", { shiftKey: true });
  pi.key("Enter", { altKey: true });
  pi.key("Enter", { ctrlKey: true });
  pi.key("P", { ctrlKey: true, shiftKey: true });
  pi.key("-", { ctrlKey: true });
  assert.deepEqual(pi.inputs, ["\x1b[13;2u", "\x1b[13;3u", "\x1b[13;5u", "\x1b[112;6u", "\x1b[45;5u"]);
  assert.equal(pi.key("Enter", { shiftKey: true, isComposing: true }), false);
  assert.equal(pi.key("Enter", { shiftKey: true, keyCode: 229 }), false);
  assert.equal(pi.key("Enter"), false);
  assert.equal(pi.key("l", { ctrlKey: true }), false);
  assert.equal(pi.key("v", { ctrlKey: true, altKey: true }), false);
  pi.dispose();
});

test("delayed paste does not steal focus or write to a disposed tab", async () => {
  let resolve;
  readClipboard = () => new Promise(done => { resolve = done; });
  const pi = setup();
  pi.event("contextmenu");
  pi.el.hiddenTab = true;
  resolve("original tab");
  await tick();
  assert.deepEqual(pi.pastes, ["original tab"]);
  assert.equal(pi.focusCount(), 0);
  pi.event("contextmenu");
  pi.dispose();
  resolve("closed tab");
  await tick();
  assert.deepEqual(pi.pastes, ["original tab"]);
  assert.equal(pi.released(), true);
  assert.equal(pi.key("v", { ctrlKey: true }), false);
  readClipboard = async () => { throw new Error("clipboard busy"); };
  const shell = setup("shell");
  shell.event("contextmenu");
  await tick();
  assert.match(shell.errors[0], /clipboard busy/);
  shell.dispose();
  readClipboard = async () => "第一行\n第二行";
});

test("OSC 52 decodes UTF-8 and ignores read requests", async () => {
  const pi = setup();
  pi.osc("c;" + Buffer.from("中文回复").toString("base64"));
  await tick();
  assert.equal(copied.at(-1), "中文回复");
  const count = copied.length;
  pi.osc("c;?");
  pi.osc("c;" + "A".repeat(100001));
  assert.equal(copied.length, count);
  pi.osc("c;invalid%%%");
  assert.equal(pi.errors.length, 1);
  pi.dispose();
});
