// What you've typed but not sent, per chat ("t:<tab>") and for a new chat ("new"): kept on this device, so switching
// chats, reloading or a new version of the page never loses it.
import { ls } from "../lib/kv";

const drafts: Record<string, string> = ls.get("agchat.drafts", {});
const listeners = new Set<(key: string) => void>();

export const getDraft = (key: string | null) => (key ? (drafts[key] ?? "") : "");
export function saveDraftText(key: string | null, text: string, onlyIfEmpty = false) {
	if (!key || (onlyIfEmpty && drafts[key])) return;
	if (text.trim()) drafts[key] = text;
	else delete drafts[key];
	ls.set("agchat.drafts", drafts);
	if (onlyIfEmpty) for (const f of listeners) f(key);
}
// A draft written from outside the box (a refused reply put back): the open box picks it up.
export const onDraftRestored = (f: (key: string) => void) => (listeners.add(f), () => void listeners.delete(f));
