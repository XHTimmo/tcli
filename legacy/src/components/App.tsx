import React, { useState } from "react";
import { Box, useApp, useInput, useStdout } from "ink";
import { Explorer } from "./Explorer.js";
import { Chat } from "./Chat.js";
import { Processes } from "./Processes.js";
import { ToolLog } from "./ToolLog.js";

const panes = ["chat", "explorer", "processes"] as const;

export function App() {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const height = (stdout?.rows ?? 30) - 1;
  // explorer 32 + processes 40 + chat borders 2
  const chatWidth = Math.max(20, (stdout?.columns ?? 120) - 32 - 40 - 2);
  const [focus, setFocus] = useState<(typeof panes)[number]>("chat");
  const [injected, setInjected] = useState("");

  useInput((input, key) => {
    if (key.ctrl && input === "c") exit();
    else if (key.tab) setFocus((f) => panes[(panes.indexOf(f) + 1) % panes.length]);
  });

  const procH = Math.floor(height / 2);
  return (
    <Box height={height}>
      <Explorer active={focus === "explorer"} height={height}
        onPick={(p) => { setInjected(`${p} `); setFocus("chat"); }} />
      <Chat active={focus === "chat"} height={height} width={chatWidth} injected={injected} clearInjected={() => setInjected("")} />
      <Box flexDirection="column">
        <Processes active={focus === "processes"} height={procH} />
        <ToolLog height={height - procH} />
      </Box>
    </Box>
  );
}
