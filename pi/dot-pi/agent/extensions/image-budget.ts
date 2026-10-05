// image-budget: keep the images in a request under the provider's size caps.
//
// Every image an agent reads (screenshots, contact sheets) stays in context as
// base64 and is resent on every turn. Anthropic rejects requests over ~32 MB
// (and over 100 images) with "413 Request exceeds the maximum size", which
// bricks the session: every later prompt fails the same way. Before each model
// call, once the images exceed the budget, this replaces the oldest ones with a
// short text note (the session file keeps the originals). It drops down to half
// the budget at a time, so the cut point moves rarely and the prompt cache holds.

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const MAX_BYTES = 20 * 1024 * 1024; // base64 chars of image data per request
const MAX_IMAGES = 60;

type Block = { type: string; data?: string; [k: string]: unknown };
type Msg = { role?: string; timestamp?: number; content?: unknown; [k: string]: unknown };

export default function (pi: ExtensionAPI) {
	const dropped = new Set<string>();

	pi.on("context", (event) => {
		const messages = event.messages as Msg[];
		const images: { key: string; size: number }[] = [];
		messages.forEach((m, mi) => {
			if (!Array.isArray(m.content)) return;
			(m.content as Block[]).forEach((b, bi) => {
				if (b?.type !== "image") return;
				const key = `${m.timestamp ?? `i${mi}`}:${bi}`;
				if (!dropped.has(key)) images.push({ key, size: b.data?.length ?? 0 });
			});
		});

		let bytes = images.reduce((s, i) => s + i.size, 0);
		let count = images.length;
		if (bytes > MAX_BYTES || count > MAX_IMAGES) {
			for (const img of images) {
				if (bytes <= MAX_BYTES / 2 && count <= MAX_IMAGES / 2) break;
				dropped.add(img.key);
				bytes -= img.size;
				count--;
			}
		}
		if (dropped.size === 0) return;

		let changed = false;
		const out = messages.map((m, mi) => {
			if (!Array.isArray(m.content)) return m;
			let touched = false;
			const content = (m.content as Block[]).map((b, bi) => {
				if (b?.type !== "image" || !dropped.has(`${m.timestamp ?? `i${mi}`}:${bi}`)) return b;
				touched = true;
				return {
					type: "text",
					text: "[Older image removed from this request to stay under the provider's size limit. Read the file again if you still need it; downscale large images (≤1500px, JPEG) before reading.]",
				};
			});
			if (!touched) return m;
			changed = true;
			return { ...m, content };
		});
		return changed ? { messages: out as typeof event.messages } : undefined;
	});
}
