import React from "react";
import { render } from "ink";
import { EventEmitter } from "node:events";
import { App } from "../src/components/App.js";
import { store } from "../src/stats.js";

class FakeOut extends EventEmitter {
  columns = 120;
  rows = 30;
  frame = "";
  write(s: string) { this.frame = s; return true; }
}
class FakeIn extends EventEmitter {
  isTTY = true;
  setRawMode() {}
  setEncoding() {}
  resume() {}
  pause() {}
  ref() {}
  unref() {}
}

const out = new FakeOut();
const now = Date.now();
store.add({ id: "1", name: "read", summary: "package.json", status: "ok", startedAt: now, ms: 3 });
store.add({ id: "2", name: "bash", summary: "npm run typecheck", status: "ok", startedAt: now, ms: 2140 });
store.add({ id: "3", name: "edit", summary: "src/agent.ts", status: "denied", startedAt: now });
store.add({ id: "4", name: "write", summary: "src/new.ts", status: "running", startedAt: now });
store.addUsage(5231, 842);

const app = render(<App />, {
  stdout: out as any,
  stdin: new FakeIn() as any,
  debug: true,
  exitOnCtrlC: false,
  patchConsole: false,
});
setTimeout(() => {
  console.log(out.frame);
  app.unmount();
  process.exit(0);
}, 1500);
