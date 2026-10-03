// The contracts between ag-rules and the runtimes that run them (~/ag/ag-rules/README.md, "Hooks"). A rule's code
// default-exports one of these; its second argument `ag` is all it may use of ag (never import ag's files: rules
// live outside the repo).

/** One Jev (TypeSafe System One) call: `state` plus `questions` → its `answers`. Throws on failure. */
export type Jev = (state: Record<string, unknown>, questions: Record<string, unknown>, timeoutMs?: number) => Promise<any>;

/** What every rule gets. */
export interface AgBase {
	jev: Jev;
}

// ---- prompt: every prompt to a Pi session, before the agent sees it (Pi extension ag-rules.ts) ----

/** A prompt the user (or the ag-inbox / ag-tickler, on their behalf) is about to send to this session. */
export interface Prompt {
	text: string;
	source: string; // pi's input source: "interactive" | "rpc" | "extension"
}
/** A prompt-origin tag (docs/reference.md, "Prompt origins"). */
export interface Origin {
	kind: string;
	label: string;
	title?: string;
	sid?: string;
	note?: string;
	[k: string]: string | undefined;
}
export interface PromptAg extends AgBase {
	/** Spin out a new Inbox session (`ag spawn`, report-back footer included); runs in the background. */
	spawn(prompt: string): void;
	/** Show the user a one-line note in this session. */
	notify(message: string): void;
	/** Make an <ag-origin> tag: framing the model reads and ag-dash shows as a chip. */
	originTag(o: Origin): string;
	/** Split a prompt into its own text and its origin tags. */
	parseOrigins(text: string): { text: string; origins: Origin[] };
}
/** Return nothing to leave the prompt alone, `text` to rewrite it, or `handled` to swallow it (with a note). */
export type PromptRule = (prompt: Prompt, ag: PromptAg) => void | { text: string } | { handled: string };

// ---- capture: is an ag-inbox capture new context for an open session? (ag-inbox) ----

export interface OpenSession {
	id: string; // tab id
	title: string; // the tab label
	first: string; // first prompt (clipped)
	latest: string; // latest prompt (clipped), "" if only one
}
/** follow = deliver into `session`; hint = new Inbox session that names `session`; new = a plain new session. */
export type CaptureRule = (
	input: { text: string; sessions: OpenSession[] },
	ag: AgBase,
) => Promise<{ action: "follow" | "hint" | "new"; session: string | null; ongoing: number; p: number } | undefined>;

// ---- new-item: what ag-dash's New item box text is for (ag-dash POST /api/new) ----

export type NewItemRule = (input: { text: string }, ag: AgBase) => Promise<{ intent: "find" | "new" } | undefined>;

// ---- answer: a chat archived while working has a new final answer; is it done? (ag-dash) ----

export type AnswerRule = (input: { request: string; reply: string }, ag: AgBase) => Promise<{ done: boolean } | undefined>;

// ---- cua: may an agent drive the client Mac's (or phone's) desktop? (ag-client-cua-gate) ----

export type CuaRule = (
	input: { kind: string /* "cua" | "ssh" */; command: string; why: string; goal: string },
	ag: AgBase,
) => Promise<{ allow: boolean; reason: string; justified?: number; drives?: number } | undefined>;

// ---- tab-name: does a tab's label still name its session? (Pi extension ag-tab-name.ts) ----

export type TabNameRule = (
	input: { label: string; first: string; later: string[] },
	ag: AgBase,
) => Promise<{ keep: boolean; p?: number } | undefined>;
