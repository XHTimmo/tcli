import React, { useEffect, useState } from "react";
import { Box, Text, useInput } from "ink";
import { execFile } from "node:child_process";
import { tasks } from "../tasks.js";

// inner width 38 = pid 6 + name + mem + 2 spaces
const MEM_W = 10;
const NAME_W = 38 - 6 - MEM_W - 2;

interface Proc { pid: number; name: string; mem: string }

function fetchProcs(): Promise<Proc[]> {
  return new Promise((res) => {
    if (process.platform === "win32") {
      execFile("tasklist", ["/FO", "CSV", "/NH"], { maxBuffer: 5e6 }, (_e, out) => {
        res(
          out.split(/\r?\n/).filter(Boolean).map((l) => {
            const c = l.replace(/^"|"$/g, "").split('","');
            return { name: c[0], pid: Number(c[1]), mem: c[4] ?? "" };
          }),
        );
      });
    } else {
      execFile("ps", ["-eo", "pid=,rss=,comm=", "--sort=-rss"], { maxBuffer: 5e6 }, (_e, out) => {
        res(
          out.split("\n").filter(Boolean).flatMap((l) => {
            const m = l.trim().match(/^(\d+)\s+(\d+)\s+(.*)$/);
            return m ? [{ pid: Number(m[1]), mem: `${Number(m[2]).toLocaleString()} K`, name: m[3] }] : [];
          }),
        );
      });
    }
  });
}

export function Processes({ active, height }: { active: boolean; height: number }) {
  const [procs, setProcs] = useState<Proc[]>([]);
  const [sel, setSel] = useState(0);
  const [msg, setMsg] = useState("");
  const [view, setView] = useState<"agent" | "system">("agent");
  const [, tick] = useState(0);
  const taskList = [...tasks.list].reverse();
  const count = view === "agent" ? taskList.length : procs.length;

  useEffect(() => {
    const f = () => tick((n) => n + 1);
    tasks.on("change", f);
    const t = setInterval(f, 1000); // keep elapsed time fresh
    return () => { tasks.off("change", f); clearInterval(t); };
  }, []);

  const refresh = () => fetchProcs().then(setProcs);
  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 3000);
    return () => clearInterval(t);
  }, []);

  useInput((input, key) => {
    if (key.upArrow) setSel((s) => Math.max(0, s - 1));
    else if (key.downArrow) setSel((s) => Math.max(0, Math.min(count - 1, s + 1)));
    else if (input === "t") { setView((v) => (v === "agent" ? "system" : "agent")); setSel(0); setMsg(""); }
    else if (input === "r") refresh();
    else if (view === "agent") {
      if (input === "k" && taskList[sel]) {
        taskList[sel].kill();
        setMsg(`interrupted #${taskList[sel].id}`);
      }
    } else if (input === "k" && procs[sel]) {
      try { process.kill(procs[sel].pid); setMsg(`killed ${procs[sel].pid}`); }
      catch (e) { setMsg(e instanceof Error ? e.message : String(e)); }
      refresh();
    }
  }, { isActive: active });

  const rows = height - 4;
  const start = Math.max(0, Math.min(sel - Math.floor(rows / 2), count - rows));
  return (
    <Box flexDirection="column" borderStyle="round" borderColor={active ? "cyan" : "gray"} width={40} height={height}>
      <Text bold> {view === "agent" ? "Agent tasks" : "System"} <Text dimColor>(t switch, k kill)</Text></Text>
      {view === "agent" && taskList.length === 0 && <Text dimColor> no bash commands yet</Text>}
      {view === "agent" && taskList.slice(start, start + rows).map((t, i) => {
        const secs = Math.round(((t.endedAt ?? Date.now()) - t.startedAt) / 1000);
        const color = { running: "cyan", done: "green", failed: "red", killed: "magenta" }[t.status];
        return (
          <Text key={t.id} inverse={start + i === sel && active} wrap="truncate">
            <Text color={color}>●</Text> {String(secs).padStart(3)}s {t.command.replace(/\s+/g, " ")}
          </Text>
        );
      })}
      {view === "system" && procs.slice(start, start + rows).map((p, i) => (
        <Text key={`${p.pid}-${i}`} inverse={start + i === sel && active} wrap="truncate">
          {String(p.pid).padStart(6)} {p.name.padEnd(NAME_W).slice(0, NAME_W)} {p.mem.padStart(MEM_W)}
        </Text>
      ))}
      <Text color="yellow" wrap="truncate">{msg}</Text>
    </Box>
  );
}
