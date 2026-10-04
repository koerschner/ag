import DOMPurify from "dompurify";
import { marked } from "marked";
import { esc, noEmoji } from "./format";
import { ICON } from "./icons";

// ag-dash session links (http://ag:7376/<sid>, the phone https link, /chat/<sid>) open in the app as /chat/<sid>.
export function chatHref(href: string): string | null {
	let u: URL;
	try {
		u = new URL(href, location.href);
	} catch {
		return null;
	}
	const h = u.hostname;
	if (h !== location.hostname && h !== "ag" && !h.startsWith("ag.")) return null;
	const sid = u.pathname.replace(/\/$/, "").match(/^(?:\/chat)?\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/)?.[1];
	return sid ? `/chat/${sid}` : null;
}

DOMPurify.addHook("afterSanitizeAttributes", (n) => {
	if (n.tagName !== "A" || !n.getAttribute("href")) return;
	const inApp = chatHref(n.getAttribute("href")!);
	if (inApp) {
		n.setAttribute("href", inApp);
		n.setAttribute("data-go", inApp);
		n.removeAttribute("target");
		return;
	}
	n.setAttribute("target", "_blank");
	n.setAttribute("rel", "noopener");
});

// Rendering markdown is the most expensive thing on the page; the same text always renders the same, so keep it.
const cache = new Map<string, string>();
export function md(s: string): string {
	const hit = cache.get(s);
	if (hit !== undefined) return hit;
	let text = noEmoji(s);
	const done = /(^|\n)\s*DONE\s*$/.test(text);
	if (done) text = text.replace(/\s*DONE\s*$/, "");
	let html = DOMPurify.sanitize(marked.parse(text, { gfm: true, breaks: true, async: false }) as string, { ADD_ATTR: ["target"] });
	if (done) html += `<p><span class="done-pill">${ICON.check}DONE</span></p>`;
	if (html.includes("<pre")) {
		const box = document.createElement("div");
		box.innerHTML = html;
		for (const pre of box.querySelectorAll("pre")) {
			const lang = pre.querySelector("code")?.className.match(/language-([\w+-]+)/)?.[1] || "";
			pre.insertAdjacentHTML("afterbegin", `<div class="code-head"><span>${esc(lang)}</span><button data-copy-code data-t="chat-copy-code">${ICON.copy}Copy code</button></div>`);
		}
		html = box.innerHTML;
	}
	if (cache.size > 800) cache.delete(cache.keys().next().value!);
	cache.set(s, html);
	return html;
}
