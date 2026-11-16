import React, { useEffect, useState } from "react";
import { Box, Text, useInput } from "ink";
import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";

interface Entry { name: string; dir: boolean }

function list(path: string): Entry[] {
  try {
    return readdirSync(path, { withFileTypes: true })
      .map((d) => ({ name: d.name, dir: d.isDirectory() }))
      .sort((a, b) => Number(b.dir) - Number(a.dir) || a.name.localeCompare(b.name));
  } catch {
    return [];
  }
}

export function Explorer({ active, height, onPick }: { active: boolean; height: number; onPick(path: string): void }) {
  const [cwd, setCwd] = useState(process.cwd());
  const [entries, setEntries] = useState<Entry[]>([]);
  const [sel, setSel] = useState(0);
  useEffect(() => { setEntries(list(cwd)); setSel(0); }, [cwd]);

  useInput((_input, key) => {
    if (key.upArrow) setSel((s) => Math.max(0, s - 1));
    else if (key.downArrow) setSel((s) => Math.min(entries.length - 1, s + 1));
    else if (key.backspace || key.leftArrow) setCwd(dirname(cwd));
    else if (key.return || key.rightArrow) {
      const e = entries[sel];
      if (!e) return;
      if (e.dir) setCwd(join(cwd, e.name));
      else onPick(join(cwd, e.name));
    }
  }, { isActive: active });

  const rows = height - 3;
  const start = Math.max(0, Math.min(sel - Math.floor(rows / 2), entries.length - rows));
  return (
    <Box flexDirection="column" borderStyle="round" borderColor={active ? "cyan" : "gray"} width={32} height={height}>
      <Text bold wrap="truncate-start"> {cwd}</Text>
      {entries.slice(start, start + rows).map((e, i) => (
        <Text key={e.name} inverse={start + i === sel && active} color={e.dir ? "blue" : undefined} wrap="truncate">
          {e.dir ? "▸ " : "  "}{e.name}
        </Text>
      ))}
    </Box>
  );
}
