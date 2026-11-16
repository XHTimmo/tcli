import React, { useEffect, useMemo, useRef, useState } from "react";
import { Box, Text, useInput } from "ink";
import { runAgent } from "../agent.js";
import { plainRows, renderMarkdown, type Row } from "../markdown.js";

interface Line { role: "user" | "assistant" | "system"; text: string }

function toRows(l: Line, width: number): Row[] {
  if (l.role === "user") return [[], ...plainRows(l.text, width, "› ", "green")];
  if (l.role === "system") return plainRows(l.text, width, "", "gray");
  return renderMarkdown(l.text, width);
}

export function Chat({ active, height, width, injected, clearInjected }: {
  active: boolean; height: number; width: number; injected: string; clearInjected(): void;
}) {
  const [lines, setLines] = useState<Line[]>([{ role: "system", text: "Tab 切换面板 · ↑↓/PgUp/PgDn 滚动 · Esc 中断 · Ctrl+C 退出" }]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [offset, setOffset] = useState(0); // rows scrolled up from the bottom
  const [pending, setPending] = useState<{ name: string; summary: string; resolve(ok: boolean): void } | null>(null);
  const abort = useRef<AbortController | null>(null);

  useEffect(() => {
    if (injected) { setInput((s) => s + injected); clearInjected(); }
  }, [injected]);

  const rows = useMemo(() => lines.filter((l) => l.text).flatMap((l) => toRows(l, width)), [lines, width]);
  const view = Math.max(1, height - 3 - (pending ? 1 : 0));
  const maxOffset = Math.max(0, rows.length - view);
  const off = Math.min(offset, maxOffset);
  const shown = rows.slice(Math.max(0, rows.length - view - off), rows.length - off);

  const appendAssistant = (delta: string) =>
    setLines((ls) => {
      const last = ls[ls.length - 1];
      if (last?.role === "assistant") return [...ls.slice(0, -1), { ...last, text: last.text + delta }];
      return [...ls, { role: "assistant", text: delta }];
    });

  const submit = async (text: string) => {
    setLines((ls) => [...ls, { role: "user", text }]);
    setOffset(0);
    setBusy(true);
    const ac = (abort.current = new AbortController());
    try {
      await runAgent(text, {
        onText: appendAssistant,
        onTurnEnd: () => setLines((ls) => [...ls, { role: "system", text: "" }]),
        approve: (name, summary) => new Promise((resolve) => setPending({ name, summary, resolve })),
      }, ac.signal);
    } catch (e) {
      if (!ac.signal.aborted) setLines((ls) => [...ls, { role: "system", text: `error: ${e instanceof Error ? e.message : e}` }]);
    }
    setBusy(false);
  };

  useInput((ch, key) => {
    if (pending) {
      if (ch === "y" || ch === "n") { pending.resolve(ch === "y"); setPending(null); }
      return;
    }
    if (key.upArrow) setOffset(Math.min(maxOffset, off + 1));
    else if (key.downArrow) setOffset(Math.max(0, off - 1));
    else if (key.pageUp) setOffset(Math.min(maxOffset, off + view - 1));
    else if (key.pageDown) setOffset(Math.max(0, off - view + 1));
    else if (key.escape) abort.current?.abort();
    else if (busy) return;
    else if (key.return) {
      if (input.trim()) { const t = input; setInput(""); void submit(t); }
    } else if (key.backspace || key.delete) setInput((s) => s.slice(0, -1));
    else if (ch && !key.ctrl && !key.meta && !key.tab) setInput((s) => s + ch);
  }, { isActive: active || !!pending });

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={active ? "cyan" : "gray"} flexGrow={1} height={height}>
      <Box flexDirection="column" flexGrow={1} overflow="hidden">
        {shown.map((row, i) => (
          <Text key={i} wrap="truncate">
            {row.length === 0 ? " " : row.map((s, j) => (
              <Text key={j} color={s.color} bold={s.bold} dimColor={s.dim} italic={s.italic}>{s.text}</Text>
            ))}
          </Text>
        ))}
      </Box>
      {pending && <Text color="yellow" wrap="truncate">允许 {pending.name}: {pending.summary} ? (y/n)</Text>}
      <Text wrap="truncate">
        {busy ? "… " : "> "}{input}{active && !busy ? "▌" : ""}
        {off > 0 ? <Text dimColor>  [↑{off}]</Text> : null}
      </Text>
    </Box>
  );
}
