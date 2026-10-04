// A chat's scrolling, ChatGPT-style: it opens at the bottom and stays pinned there as messages arrive, images load
// or the box grows. Scrolled up to read, nothing moves under you: the turn at the top of the view is the anchor, and
// whatever changes above or below it (older pages loading, new messages, the window of loaded messages moving),
// it stays where it was on screen. A ↓ button takes you back down. Scrolling near the top loads the next older page.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

const NEAR = 150;

export function useStickyScroll(key: string, opts: { onTop?: () => Promise<boolean> | null | void; onBottom?: () => void }) {
	const scroll = useRef<HTMLDivElement>(null);
	const content = useRef<HTMLDivElement>(null);
	const atBottom = useRef(true);
	const anchor = useRef<{ key: string; off: number; fromBottom: number } | null>(null);
	const [away, setAway] = useState(false);
	const loadingOlder = useRef(false);
	const lastTop = useRef(-1);
	const opt = useRef(opts);
	opt.current = opts;

	const toBottom = useCallback((smooth = false) => {
		const s = scroll.current;
		if (!s) return;
		atBottom.current = true;
		anchor.current = null;
		setAway(false);
		s.scrollTo({ top: s.scrollHeight, behavior: smooth ? "smooth" : "auto" });
	}, []);

	// The first turn still visible at the top of the view, and where it sits. A turn that starts with a prompt is
	// preferred: the oldest loaded turn often starts mid-way (no prompt yet) and changes key when older items load.
	// fromBottom is the fallback when the anchor is gone.
	const capture = useCallback(() => {
		const s = scroll.current, c = content.current;
		if (!s || !c) return;
		const box = s.getBoundingClientRect();
		const fromBottom = s.scrollHeight - s.scrollTop;
		let first: { key: string; off: number } | null = null;
		for (const el of c.querySelectorAll<HTMLElement>("[data-turn]")) {
			const r = el.getBoundingClientRect();
			if (r.bottom <= box.top) continue;
			if (r.top >= box.bottom) break;
			const a = { key: el.dataset.turn!, off: r.top - box.top };
			if (!a.key.startsWith("t:")) return void (anchor.current = { ...a, fromBottom });
			first ??= a;
		}
		anchor.current = first ? { ...first, fromBottom } : { key: "", off: 0, fromBottom };
	}, []);

	// A new chat opens at the bottom.
	useLayoutEffect(() => {
		atBottom.current = true;
		anchor.current = null;
		setAway(false);
		const s = scroll.current;
		if (s) s.scrollTop = s.scrollHeight;
	}, [key]);

	// Whatever changes size: at the bottom, stay there; scrolled up, keep the anchor turn where it was.
	useEffect(() => {
		const s = scroll.current, c = content.current;
		if (!s || !c) return;
		const ro = new ResizeObserver(() => {
			if (atBottom.current) return void (s.scrollTop = s.scrollHeight);
			const a = anchor.current;
			if (!a) return;
			const el = a.key ? c.querySelector<HTMLElement>(`[data-turn="${CSS.escape(a.key)}"]`) : null;
			if (!el) s.scrollTop = s.scrollHeight - a.fromBottom;
			else {
				const d = el.getBoundingClientRect().top - s.getBoundingClientRect().top - a.off;
				if (Math.abs(d) >= 1) s.scrollTop += d;
			}
			// The correction keeps the anchor (the scroll event it causes isn't a move of yours).
			lastTop.current = s.scrollTop;
			if (!el) a.fromBottom = s.scrollHeight - s.scrollTop;
		});
		ro.observe(c);
		ro.observe(s);
		return () => ro.disconnect();
	}, [key]);

	const onScroll = useCallback(() => {
		const s = scroll.current;
		if (!s) return;
		const near = s.scrollHeight - s.scrollTop - s.clientHeight < NEAR;
		const back = near && !atBottom.current; // came back down to the bottom (not merely still there)
		atBottom.current = near;
		setAway(!near);
		// Re-anchor only when the view actually moved: a browser can fire scroll after content changed without the
		// position changing (the ResizeObserver hasn't corrected it yet), and that must not overwrite the anchor.
		if (near) anchor.current = null;
		else if (s.scrollTop !== lastTop.current || !anchor.current) capture();
		lastTop.current = s.scrollTop;
		if (back && !loadingOlder.current && s.scrollTop >= 400) opt.current.onBottom?.();
		if (s.scrollTop < 400 && !loadingOlder.current) {
			const p = opt.current.onTop?.();
			if (p) {
				loadingOlder.current = true;
				void p.then((again) =>
					requestAnimationFrame(() => {
						loadingOlder.current = false;
						if (again) onScroll(); // flung to the top (or still too short to scroll): keep going
					}),
				);
			}
		}
	}, [capture]);

	return { scroll, content, onScroll, away, toBottom, atBottom };
}
