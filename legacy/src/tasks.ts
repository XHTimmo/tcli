import { EventEmitter } from "node:events";

export interface Task {
  id: number;
  command: string;
  startedAt: number;
  status: "running" | "done" | "failed" | "killed";
  exitCode?: number | null;
  endedAt?: number;
  kill(): void;
}

class Tasks extends EventEmitter {
  list: Task[] = [];
  private seq = 0;

  start(command: string, ac: AbortController): Task {
    const t: Task = {
      id: ++this.seq,
      command,
      startedAt: Date.now(),
      status: "running",
      kill: () => {
        if (t.status === "running") {
          t.status = "killed";
          ac.abort();
        }
      },
    };
    this.list.push(t);
    this.emit("change");
    return t;
  }

  finish(t: Task, exitCode: number | null) {
    t.endedAt = Date.now();
    t.exitCode = exitCode;
    if (t.status === "running") t.status = exitCode === 0 ? "done" : "failed";
    this.emit("change");
  }
}

export const tasks = new Tasks();
