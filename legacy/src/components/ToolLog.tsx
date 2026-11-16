import React from "react";
import { Box, Text } from "ink";
import { useStore } from "./useStore.js";

const color = { pending: "yellow", running: "cyan", ok: "green", error: "red", denied: "magenta" } as const;

export function ToolLog({ height }: { height: number }) {
  const s = useStore();
  const byName = new Map<string, number>();
  for (const c of s.calls) byName.set(c.name, (byName.get(c.name) ?? 0) + 1);
  const rows = height - 5;
  return (
    <Box flexDirection="column" borderStyle="round" borderColor="gray" width={40} height={height}>
      <Text bold> Tool calls <Text dimColor>({s.calls.length})</Text></Text>
      <Text dimColor wrap="truncate"> {[...byName].map(([k, v]) => `${k}:${v}`).join(" ")}</Text>
      <Text dimColor> tokens in {s.usage.input} / out {s.usage.output}</Text>
      {s.calls.slice(-rows).map((c) => (
        <Text key={c.id} wrap="truncate">
          <Text color={color[c.status]}>●</Text> {c.name} <Text dimColor>{c.summary}</Text>{c.ms != null ? ` ${c.ms}ms` : ""}
        </Text>
      ))}
    </Box>
  );
}
