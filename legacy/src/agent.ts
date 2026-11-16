import {
  createAgentSession,
  DefaultResourceLoader,
  getAgentDir,
  createBashTool,
  createLocalBashOperations,
  type AgentSession,
} from "@earendil-works/pi-coding-agent";
import { store } from "./stats.js";
import { tasks } from "./tasks.js";

export interface AgentHooks {
  onText(delta: string): void;
  onTurnEnd(): void;
  approve(name: string, summary: string): Promise<boolean>;
}

const NEEDS_APPROVAL = new Set(["bash", "write", "edit"]);

const summarize = (args: Record<string, any> | undefined) =>
  String(args?.command ?? args?.path ?? args?.file_path ?? "");

let hooks: AgentHooks | null = null;
let sessionP: Promise<AgentSession> | null = null;

function getSession(): Promise<AgentSession> {
  sessionP ??= (async () => {
    const resourceLoader = new DefaultResourceLoader({
      cwd: process.cwd(),
      agentDir: getAgentDir(),
      extensionFactories: [
        (pi) => {
          // Wrap bash so each command is registered as a task that can be killed on its own.
          const local = createLocalBashOperations();
          const bashTool = createBashTool(process.cwd(), {
            operations: {
              exec: async (command, cwd, opts) => {
                const ac = new AbortController();
                const task = tasks.start(command, ac);
                const onAbort = () => ac.abort();
                opts.signal?.addEventListener("abort", onAbort);
                try {
                  const r = await local.exec(command, cwd, { ...opts, signal: ac.signal });
                  tasks.finish(task, r.exitCode);
                  return r;
                } catch (e) {
                  tasks.finish(task, null);
                  throw e;
                } finally {
                  opts.signal?.removeEventListener("abort", onAbort);
                }
              },
            },
          });
          pi.registerTool({
            ...bashTool,
            execute: (id, params, signal, onUpdate) => bashTool.execute(id, params, signal, onUpdate),
          });

          // Route pi's tool confirmation through the Chat panel's y/n prompt.
          pi.on("tool_call", async (event) => {
            if (!NEEDS_APPROVAL.has(event.toolName) || !hooks) return undefined;
            const ok = await hooks.approve(event.toolName, summarize(event.input));
            return ok ? undefined : { block: true, reason: "User denied this action." };
          });
        },
      ],
    });
    await resourceLoader.reload();
    const { session } = await createAgentSession({ resourceLoader });

    session.subscribe((e) => {
      switch (e.type) {
        case "message_update":
          if (e.assistantMessageEvent.type === "text_delta") hooks?.onText(e.assistantMessageEvent.delta);
          break;
        case "message_end":
          if (e.message.role === "assistant") {
            store.addUsage(e.message.usage.input, e.message.usage.output);
            hooks?.onTurnEnd();
          }
          break;
        case "tool_execution_start":
          store.add({
            id: e.toolCallId,
            name: e.toolName,
            summary: summarize(e.args),
            status: "running",
            startedAt: Date.now(),
          });
          break;
        case "tool_execution_end":
          store.update(e.toolCallId, { status: e.isError ? "error" : "ok", ms: e.durationMs });
          break;
      }
    });
    return session;
  })();
  return sessionP;
}

export async function runAgent(prompt: string, h: AgentHooks, signal: AbortSignal) {
  hooks = h;
  const session = await getSession();
  const onAbort = () => void session.abort();
  signal.addEventListener("abort", onAbort);
  try {
    await session.prompt(prompt);
  } finally {
    signal.removeEventListener("abort", onAbort);
    hooks = null;
  }
}
