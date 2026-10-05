// navigator.clipboard only exists in secure contexts (https, localhost). ag-dash is usually served over plain
// http://ag:7376 (the Mac app, desktop browsers), where it is undefined, so fall back to a hidden textarea and
// execCommand("copy"), which still works inside the click that triggered it.
export async function copyText(text: string): Promise<void> {
	if (navigator.clipboard && window.isSecureContext) {
		try {
			return await navigator.clipboard.writeText(text);
		} catch {}
	}
	const ta = document.createElement("textarea");
	ta.value = text;
	ta.setAttribute("readonly", "");
	ta.style.cssText = "position:fixed;top:0;left:0;opacity:0;pointer-events:none";
	const active = document.activeElement as HTMLElement | null;
	document.body.appendChild(ta);
	ta.select();
	const ok = document.execCommand("copy");
	ta.remove();
	active?.focus?.();
	if (!ok) throw new Error("Copy failed");
}
