// The contract between prompt ag-rules and the Pi extension that runs them (pi/dot-pi/agent/extensions/ag-rules.ts).

/** A prompt Nathan (or the ag inbox / tickler, on his behalf) is about to send to this session. */
export interface Prompt {
	text: string;
	source: string; // pi's input source: "interactive" | "rpc" | "extension"
}

/** What a rule may do, beyond rewriting the prompt. */
export interface Ag {
	/** Spin out a new Inbox session (`ag spawn`, report-back footer included); runs in the background. */
	spawn(prompt: string): void;
	/** Show Nathan a one-line note in this session. */
	notify(message: string): void;
}

/** Return nothing to leave the prompt alone, `text` to rewrite it, or `handled` to swallow it (with a note). */
export type PromptRule = (prompt: Prompt, ag: Ag) => void | { text: string } | { handled: string };
