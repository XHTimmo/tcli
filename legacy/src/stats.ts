import { EventEmitter } from "node:events";

export interface ToolCall {
  id: string;
  name: string;
  summary: string;
  status: "pending" | "running" | "ok" | "error" | "denied";
  startedAt: number;
  ms?: number;
}

export interface Usage {
  input: number;
  output: number;
}

class Store extends EventEmitter {
  calls: ToolCall[] = [];
  usage: Usage = { input: 0, output: 0 };

  add(call: ToolCall) {
    this.calls.push(call);
    this.emit("change");
  }
  update(id: string, patch: Partial<ToolCall>) {
    const c = this.calls.find((x) => x.id === id);
    if (c) Object.assign(c, patch);
    this.emit("change");
  }
  addUsage(input: number, output: number) {
    this.usage.input += input;
    this.usage.output += output;
    this.emit("change");
  }
}

export const store = new Store();
