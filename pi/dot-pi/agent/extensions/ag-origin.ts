/**
 * ag-origin: where a prompt came from, kept out of the text the user reads.
 *
 * Ag's injectors (ag-inbox follow-ons and hints, ag spawn / ag report, the ag-tickler, ag-rules, phone review
 * comments) don't write their routing preamble into the prompt as prose. They wrap it in one tag:
 *
 *   <ag-origin kind="report" label="Report from" title="Fix Ag Inbox" sid="01a1…">terse note for the model</ag-origin>
 *
 * The model reads the tag as is (the note says what it needs to know: who sent it, what to do with it). The UIs
 * hide it and show a small chip instead: AG Dash (server strips tags from user text and sends `origins`), and
 * Pi's own transcript (the markdown transformer below swaps each tag for a dim one-line chip). `label` is the
 * chip text; `title` + `sid` make it a link to that session. Helpers are exported for ag-inbox, the ag-tickler,
 * ag-file-inbox and ag-rules (Python: aglib.origin_tag / strip_origins). Docs: docs/reference.md, "Prompt origins".
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export type Origin = { kind: string; label: string; title?: string; sid?: string; note: string; [k: string]: string | undefined };

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const unesc = (s: string) => s.replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
const TAG = /<ag-origin\b([^>]*)>([\s\S]*?)<\/ag-origin>[ \t]*\n*/g;

/** One origin tag. Attributes with empty values are left out. */
export function originTag(o: { kind: string; label: string; title?: string; sid?: string; note?: string; [k: string]: string | undefined }): string {
	const { note = "", ...attrs } = o;
	const a = Object.entries(attrs).filter(([, v]) => v).map(([k, v]) => ` ${k}="${esc(String(v))}"`).join("");
	return `<ag-origin${a}>${note.replace(/<\/ag-origin>/g, "")}</ag-origin>`;
}

/** The text with every origin tag removed, plus the origins in order. */
export function parseOrigins(text: string): { text: string; origins: Origin[] } {
	const origins: Origin[] = [];
	const rest = text.replace(TAG, (_m, attrs: string, note: string) => {
		const o: any = { note: note.trim() };
		for (const [, k, v] of attrs.matchAll(/(\w+)="([^"]*)"/g)) o[k] = unesc(v);
		origins.push(o);
		return "";
	});
	return { text: origins.length ? rest.replace(/\n{3,}/g, "\n\n").trim() : text, origins };
}

export const stripOrigins = (text: string) => parseOrigins(text).text;

/** The chip text for one origin: "Report from Fix Ag Inbox". */
export const chipText = (o: Origin) => [o.label, o.title && `“${o.title}”`].filter(Boolean).join(" ");

/** What a model judging or naming a session should read: the text without tags, each tag's chip on top. */
export function promptGist(text: string): string {
	const { text: rest, origins } = parseOrigins(text);
	return [...origins.map((o) => `(${chipText(o)})`), rest].join("\n");
}

export default function (pi: ExtensionAPI) {
	pi.registerMarkdownTransformer?.((markdown, ctx) => {
		if (ctx.messageType !== "user" || !markdown.includes("<ag-origin")) return markdown;
		const { text, origins } = parseOrigins(markdown);
		if (!origins.length) return markdown;
		return `${origins.map((o) => `*↪ ${chipText(o)}*`).join("  \n")}\n\n${text}`;
	});
}
