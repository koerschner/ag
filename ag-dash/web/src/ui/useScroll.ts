// A chat's scrolling. The browser owns the scroll position; this only decides whether to follow the bottom.
//
// Why it can't jump: nothing is ever inserted or resized above what you're reading. The whole transcript loads at
// once and only its end changes as the agent works (state/tx.ts), and media reserve their height before they load
// (styles.css), so there is nothing to compensate for and no correction to race your scrolling. This writes scrollTop
// only when you ask for it (opening a chat, ↓, sending) and while it follows the bottom. Following stops on any scroll
// input of yours toward older messages (wheel, touch, keys, the scrollbar), never on a scroll event (those can be the
// browser's own clamping or this hook's writes), and resumes when you scroll back down to the bottom.
//
// The one layout change that can still move what you're reading is a change of width (sidebar, window, rotation),
// which reflows everything: the turn at the top of the view keeps its place then.
import { createContext, useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";

const NEAR = 80;
const UP_KEYS = new Set(["PageUp", "ArrowUp", "Home"]);

// Steps (Thread.tsx) fold away when their turn ends only while following: folding while you read would pull the
// page out from under you.
export const FollowContext = createContext<RefObject<boolean> | null>(null);

export function useStickyScroll(key: string) {
	const scroll = useRef<HTMLDivElement>(null);
	const content = useRef<HTMLDivElement>(null);
	const follow = useRef(true);
	const [away, setAway] = useState(false);
	const lastTop = useRef(0);
	const anchor = useRef<{ el: Element; off: number } | null>(null);

	const setFollow = useCallback((on: boolean) => {
		follow.current = on;
		setAway(!on);
	}, []);

	const toBottom = useCallback(
		(smooth = false) => {
			const s = scroll.current;
			setFollow(true);
			s?.scrollTo({ top: s.scrollHeight, behavior: smooth ? "smooth" : "auto" });
		},
		[setFollow],
	);

	// A chat opens at the bottom, following.
	useLayoutEffect(() => {
		setFollow(true);
		const s = scroll.current;
		if (s) s.scrollTop = lastTop.current = s.scrollHeight;
	}, [key, setFollow]);

	useEffect(() => {
		const s = scroll.current, c = content.current;
		if (!s || !c) return;
		const unfollow = () => follow.current && setFollow(false);
		const onWheel = (e: WheelEvent) => e.deltaY < 0 && unfollow();
		let touchY = 0;
		const onTouchStart = (e: TouchEvent) => void (touchY = e.touches[0]?.clientY ?? 0);
		const onTouchMove = (e: TouchEvent) => (e.touches[0]?.clientY ?? 0) > touchY + 2 && unfollow(); // finger down = scroll up
		const onKey = (e: KeyboardEvent) => {
			const t = e.target as HTMLElement | null;
			if ((UP_KEYS.has(e.key) || (e.key === " " && e.shiftKey)) && !t?.closest?.("input, textarea, select, [contenteditable]")) unfollow();
		};
		const onPointer = (e: PointerEvent) => e.target === s && unfollow(); // the scrollbar
		s.addEventListener("wheel", onWheel, { passive: true });
		s.addEventListener("touchstart", onTouchStart, { passive: true });
		s.addEventListener("touchmove", onTouchMove, { passive: true });
		addEventListener("keydown", onKey);
		s.addEventListener("pointerdown", onPointer);

		// Following: whatever grows (new messages, the composer, the keyboard), stay at the bottom.
		// Not following: leave the position alone, except to keep the top turn in place when the width changes.
		let width = s.clientWidth;
		const ro = new ResizeObserver(() => {
			const widthChanged = s.clientWidth !== width;
			width = s.clientWidth;
			if (follow.current) return void (s.scrollTop = lastTop.current = s.scrollHeight);
			const a = anchor.current;
			if (!widthChanged || !a?.el.isConnected) return;
			const d = a.el.getBoundingClientRect().top - s.getBoundingClientRect().top - a.off;
			if (Math.abs(d) >= 1) s.scrollTop = lastTop.current = s.scrollTop + d;
		});
		ro.observe(c);
		ro.observe(s);
		return () => {
			ro.disconnect();
			s.removeEventListener("wheel", onWheel);
			s.removeEventListener("touchstart", onTouchStart);
			s.removeEventListener("touchmove", onTouchMove);
			removeEventListener("keydown", onKey);
			s.removeEventListener("pointerdown", onPointer);
		};
	}, [key, setFollow]);

	// Back down at the bottom (moving down, so a nudge up from the bottom doesn't count): follow again.
	// Not following: note the turn at the top of the view, for a width change (see above).
	const capturing = useRef(false);
	const onScroll = useCallback(() => {
		const s = scroll.current, c = content.current;
		if (!s || !c) return;
		const down = s.scrollTop > lastTop.current;
		lastTop.current = s.scrollTop;
		if (!follow.current && down && s.scrollHeight - s.scrollTop - s.clientHeight < NEAR) setFollow(true);
		if (follow.current || capturing.current) return;
		capturing.current = true;
		requestAnimationFrame(() => {
			capturing.current = false;
			const top = s.getBoundingClientRect().top;
			for (const el of c.querySelectorAll("[data-turn]")) {
				const r = el.getBoundingClientRect();
				if (r.bottom > top) return void (anchor.current = { el, off: r.top - top });
			}
		});
	}, [setFollow]);

	return { scroll, content, onScroll, away, toBottom, follow };
}
