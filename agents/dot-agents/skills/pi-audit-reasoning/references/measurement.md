# How Pi timing is measured

Source: Pi session JSONL (`~/.pi/agent/sessions/<cwd>/<ts>_<id>.jsonl`, schema v3). Every entry has an ISO `timestamp` (when it was appended); messages also carry `message.timestamp` in epoch ms.

| Interval | Start | End |
|---|---|---|
| Turn | user message `message.timestamp` | last model/tool/compaction event before the next user message; `cutoff` if still running |
| Model request | assistant `message.timestamp` (request start) | assistant entry `timestamp` (message saved) |
| Tool call | assistant entry `timestamp` (tool calls dispatched) | `toolResult.message.timestamp` |
| Compaction | previous entry `timestamp` (inferred) | compaction entry `timestamp` |

Categories: `stopReason` `error`/`aborted` → Failed / aborted model request. Tool names map as follows: `bash` → Shell commands, or Waiting when the first real command is `sleep` or a loop; `read`/`grep`/`find`/`ls` → File reads; `edit`/`write` → File edits; `mcp_*` → MCP tool calls; `subagent`/`chatgpt_cua` → Subagents & computer use; everything else → Other tools.

## Blind spots

- **Parallel tool batches.** Pi's default parallel mode awaits the whole batch and then stamps every `toolResult` with `Date.now()` (pi-agent-core `createToolResultMessage`). So each tool in a multi-tool batch appears to span the entire batch. Different categories in one batch become Concurrent activity. Per-tool durations in "Shell time by program" are inclusive and overlap within a batch. Single-tool calls are exact.
- **Model phases.** Queueing, prompt processing, thinking and output streaming are one interval; Pi records no time to first token. `usage.reasoning` tokens are reported but not timed.
- **Tool start** includes preflight and extension `tool_call` hooks.
- **Compaction** records no start. The previous entry is used when it is at most 5 minutes earlier; otherwise the compaction is excluded and a warning is emitted (typically a manual `/compact` after idle time).
- **Turns.** Steering or queued user messages start a new turn. A turn that ends mid-tool-loop and is followed by a new prompt is marked `interrupted`. Session trees (`/tree` branches) are read in file order, so abandoned branches still count as time spent.
- **Fleet.** Only completed turns that start inside the window are counted. Each turn is attributed to the model that took most of its model time, together with the turn's thinking level. Different models did different tasks, so this is not a controlled comparison.
