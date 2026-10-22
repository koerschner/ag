/**
 * Never send a tool result whose tool call is gone.
 *
 * When a reply hits the output limit mid tool call, Pi answers the cut-off
 * call with a synthetic tool result. Its overflow recovery can later omit
 * that reply from context without omitting the result (`_prepareRun` checks
 * the last reply with no tool results), and the next request then carries a
 * `tool_result` with no `tool_use` before it. Anthropic refuses such a request
 * with a 400 ("unexpected `tool_use_id` found in `tool_result` blocks"), every
 * time, so the session is stuck until the transcript is repaired by hand.
 *
 * Before each model call this keeps a tool result only when the assistant
 * message just before its run of results made that call, and drops the rest
 * from the request (the transcript keeps them).
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

type Message = { role: string; content?: unknown; toolCallId?: string };

/**
 * The messages with every orphaned tool result left out.
 *
 * @param messages - the request's messages, oldest first
 * @returns the kept messages, and the ids of the results left out
 */
export function dropOrphanToolResults<M extends Message>(messages: M[]): { kept: M[]; dropped: string[] } {
	const kept: M[] = [];
	const dropped: string[] = [];
	let calls = new Set<string>();

	for (const message of messages) {
		if (message.role === "toolResult") {
			if (message.toolCallId && calls.has(message.toolCallId)) kept.push(message);
			else dropped.push(message.toolCallId ?? "(no id)");
			continue;
		}
		calls = new Set(
			message.role === "assistant" && Array.isArray(message.content)
				? message.content.flatMap((part) => (part?.type === "toolCall" && typeof part.id === "string" ? [part.id] : []))
				: [],
		);
		kept.push(message);
	}

	return { kept, dropped };
}

export default function (pi: ExtensionAPI) {
	const reported = new Set<string>();

	pi.on("context", (event, ctx) => {
		const { kept, dropped } = dropOrphanToolResults(event.messages as Message[]);
		if (dropped.length === 0) return;
		const fresh = dropped.filter((id) => !reported.has(id));
		if (fresh.length) {
			for (const id of fresh) reported.add(id);
			ctx.ui.notify(`Left ${fresh.length} tool result(s) out of the request: their tool call is no longer in context.`, "warning");
		}
		return { messages: kept as typeof event.messages };
	});
}
