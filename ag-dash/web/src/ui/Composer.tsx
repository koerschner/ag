// The message box. Enter sends (while the agent works, as steering: delivered after the current step); ■ stops;
// the mic turns speech into text in the box; the round button with an empty box records and sends a voice message.
// On a desktop a chat opens with a one-line Reply bar (r or a click opens the box; leaving it empty folds it back),
// like Gmail. What you type is kept per chat on this device until it's sent.
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { isWorking } from "../lib/format";
import type { Card } from "../lib/types";
import { stop } from "../state/actions";
import { getDraft, onDraftRestored, saveDraftText } from "../state/drafts";
import { addSent, queue, removeSent } from "../state/outbox";
import { isMobile, toast, useUi } from "../state/ui";
import { Icon } from "./Icon";
import { composerKeys } from "./keyboard";

// The one composer on screen, for keyboard shortcuts and "Edit message".
export const composer = {
	send: (_o: { pin?: boolean; interrupt?: boolean }) => {},
	open: () => {},
	leave: () => {},
	dictate: () => {},
	setText: (_t: string) => {},
	recording: () => false,
	pending: () => false, // something a reload would lose (a recording, attachments)
	cancelRec: () => {},
	exists: () => false,
};

type Props = { card?: Card | null; draftKey: string; placeholder?: string; onNew?: (text: string, audio?: Blob) => void; onSent?: () => void; note?: string };

export function Composer({ card, draftKey, placeholder = "Ask anything", onNew, onSent, note }: Props) {
	const mobile = isMobile();
	const [text, setText] = useState(() => getDraft(draftKey) || (card ? getDraft(`t:${card.tab}`) : "")); // t:<tab>: drafts kept before they moved to session ids
	const [atts, setAtts] = useState<string[]>([]);
	const [focused, setFocused] = useState(false);
	const [rec, setRec] = useState<Recording | null>(null);
	const [hint, setHint] = useState("");
	const [drag, setDrag] = useState(false);
	const [collapsed, setCollapsed] = useState(() => !mobile && !!card && !getDraft(draftKey));
	const input = useRef<HTMLTextAreaElement>(null);
	const wrap = useRef<HTMLDivElement>(null);
	const file = useRef<HTMLInputElement>(null);
	const working = isWorking(card);

	// Drafts: saved a moment after typing stops, and when leaving the chat or the page.
	// A draft kept under the old page's key moves to this one (and isn't left behind to come back after sending).
	useEffect(() => {
		if (card && getDraft(`t:${card.tab}`) && `t:${card.tab}` !== draftKey) saveDraftText(`t:${card.tab}`, "");
	}, [card?.tab, draftKey]);
	const textRef = useRef(text);
	textRef.current = text;
	useEffect(() => {
		const t = setTimeout(() => saveDraftText(draftKey, text), 400);
		return () => clearTimeout(t);
	}, [text, draftKey]);
	useEffect(() => {
		const save = () => saveDraftText(draftKey, textRef.current);
		addEventListener("pagehide", save);
		return () => (removeEventListener("pagehide", save), save());
	}, [draftKey]);
	useEffect(() => onDraftRestored((k) => k === draftKey && !textRef.current && (setText(getDraft(k)), setCollapsed(false))), [draftKey]);

	// The box grows with its text (up to 40% of the screen).
	useLayoutEffect(() => {
		const i = input.current;
		if (!i) return;
		i.style.height = "auto";
		i.style.height = `${Math.min(i.scrollHeight, innerHeight * 0.4)}px`;
	}, [text, collapsed]);

	// An explicit "new chat" (c, ⇧⌘O, the compose button) starts in the box; just landing on a page doesn't.
	useEffect(() => {
		if (!card && useUi.getState().focusNew && !mobile) input.current?.focus();
		useUi.setState({ focusNew: false });
	}, [card, mobile]);

	const message = () => [text.trim(), ...atts].filter(Boolean).join("\n\n");
	const clear = () => {
		textRef.current = ""; // before anything unmounts this box (a new chat's page), so its draft isn't saved again
		setText("");
		setAtts([]);
		saveDraftText(draftKey, "");
		input.current?.blur(); // sending leaves the box (back to Gmail keys; r to write again)
	};
	function send(o: { pin?: boolean; interrupt?: boolean } = {}) {
		const m = message();
		if (!m) return;
		clear();
		if (!card) return void onNew?.(m);
		queue({ kind: "reply", tab: card.tab, text: m, interrupt: !!o.interrupt, pin: !!o.pin });
		onSent?.();
		if (!mobile) setCollapsed(true);
	}
	const open = () => {
		setCollapsed(false);
		requestAnimationFrame(() => input.current?.focus());
	};
	const collapseIfEmpty = () => {
		if (mobile || !card || rec || textRef.current.trim() || atts.length || wrap.current?.contains(document.activeElement)) return;
		setCollapsed(true);
	};

	async function upload(files: File[]) {
		if (!files.length) return;
		const fd = new FormData();
		for (const f of files) fd.append("file", f);
		toast(`Uploading ${files.length} file${files.length === 1 ? "" : "s"}…`);
		try {
			const j = await (await fetch("/api/upload", { method: "POST", body: fd })).json();
			if (!j.ok) throw new Error(j.error);
			setAtts((a) => [...a, ...j.paths]);
			toast("Attached");
		} catch (e: any) {
			toast(`Upload failed: ${e.message}`);
		}
	}

	// ---------- voice ----------
	async function startRec(mode: "box" | "send") {
		if (rec) return;
		if (mode === "box") open();
		if (!isSecureContext) {
			toast("Voice needs the https page; switching…");
			const url = useUi.getState().config?.httpsUrl;
			if (url) location.href = url + location.pathname + location.search;
			return;
		}
		try {
			setRec(await record(mode));
		} catch {
			toast("Microphone not available");
		}
	}
	async function endRec(cancel: boolean) {
		if (!rec) return;
		const r = rec;
		setRec(null);
		const blob = await r.stop();
		if (cancel || blob.size < 2000) return;
		if (r.mode === "box") {
			setHint("Transcribing…");
			const fd = new FormData();
			fd.append("audio", blob, "dictation.webm");
			try {
				const j = await (await fetch("/api/transcribe", { method: "POST", body: fd })).json();
				if (!j.ok) throw new Error(j.error);
				setText((t) => (t.trim() ? t.replace(/\s*$/, " ") : "") + j.text);
				input.current?.focus();
			} catch (e: any) {
				toast(`Transcription failed: ${e.message}`);
			}
			setHint("");
			return;
		}
		const typed = message();
		clear();
		if (!card) return void onNew?.(typed, blob);
		const ph = { tab: card.tab, text: (typed ? `${typed}\n\n` : "") + "Voice message (transcribing…)", ts: Date.now(), voice: true };
		addSent(ph);
		onSent?.();
		const fd = new FormData();
		fd.append("tab", card.tab);
		fd.append("text", typed);
		fd.append("audio", blob, "dictation.webm");
		try {
			const r = await fetch("/api/dictate", { method: "POST", body: fd });
			if (!r.ok) throw new Error(String(r.status));
		} catch (e: any) {
			toast(`Voice message failed: ${e.message}`);
		}
		setTimeout(() => removeSent(ph), 20000);
	}

	useLayoutEffect(() => {
		Object.assign(composer, {
		send,
		open,
		leave: () => (input.current?.blur(), setTimeout(collapseIfEmpty, 0)),
		dictate: () => (rec ? endRec(false) : startRec("box")),
		setText: (t: string) => (setText(t), open()),
		recording: () => !!rec,
		pending: () => !!rec || atts.length > 0,
		cancelRec: () => endRec(true),
		exists: () => true,
		});
	});
	// A layout effect, so a box going away resets this before the next chat's box registers itself (passive effect
	// cleanups run after the new box's layout effects).
	useLayoutEffect(() => () => void Object.assign(composer, { exists: () => false, pending: () => false, recording: () => false }), []);

	const has = !!(text.trim() || atts.length);
	const mode = has ? "send" : working ? "stop" : "voice";
	const label = mode === "stop" ? "Stop" : mode === "voice" ? "Talk: dictate and send" : working ? "Steer (Enter) · ⌥⌘Enter interrupts and sends" : "Send (Enter)";
	const show = collapsed && !focused && !has && !rec;
	return (
		<div
			ref={wrap}
			className={`composer-wrap${show ? " collapsed" : ""}`}
			onFocus={() => setFocused(true)}
			onBlur={(e) => {
				if (!wrap.current?.contains(e.relatedTarget as Node)) {
					setFocused(false);
					setTimeout(collapseIfEmpty, 0);
				}
			}}
			onDragOver={() => show && open()}
		>
			<div className="reply-bar">
				<button className="open" onClick={open} data-t="chat-reply-open">
					<Icon name="chat" />
					<span className="grow">Reply</span>
					<kbd>R</kbd>
				</button>
				{working && (
					<button className="rb primary" title="Stop" aria-label="Stop" onClick={() => stop(card)}>
						<Icon name="stop" />
					</button>
				)}
			</div>
			<div
				className={`composer${drag ? " drag" : ""}`}
				onDragOver={(e) => (e.preventDefault(), setDrag(true))}
				onDragLeave={() => setDrag(false)}
				onDrop={(e) => {
					e.preventDefault();
					setDrag(false);
					void upload([...e.dataTransfer.files]);
				}}
			>
				{atts.length > 0 && (
					<div className="attachments">
						{atts.map((p, k) => (
							<span className="att" key={p}>
								<span className="fi">
									<Icon name="file" />
								</span>
								<span title={p}>{p.split("/").pop()}</span>
								<button aria-label="Remove" onClick={() => setAtts((a) => a.filter((_, i) => i !== k))}>
									✕
								</button>
							</span>
						))}
					</div>
				)}
				<textarea
					ref={input}
					id="input"
					rows={1}
					placeholder={placeholder}
					aria-label="Message"
					enterKeyHint="send"
					value={text}
					onChange={(e) => setText(e.target.value)}
					onKeyDown={(e) => composerKeys(e.nativeEvent)}
					onPaste={(e) => {
						const fs = [...(e.clipboardData?.files || [])];
						if (fs.length) (e.preventDefault(), void upload(fs));
					}}
				/>
				{rec ? (
					<div className="recbar">
						<button className="rb" title="Cancel" aria-label="Cancel recording" onClick={() => endRec(true)}>
							<Icon name="x" />
						</button>
						<Bars rec={rec} />
						<button className="rb primary" title="Done" aria-label="Finish recording" onClick={() => endRec(false)}>
							<Icon name="check" />
						</button>
					</div>
				) : (
					<div className="row2">
						<button className="rb" title="Add photos & files" aria-label="Add photos and files" data-t="chat-attach" onClick={() => file.current?.click()}>
							<Icon name="plus" />
						</button>
						<span className="grow">
							<span className="hint">{hint || (working && text.trim() ? "Queued until the current step finishes" : "")}</span>
						</span>
						{!(isSecureContext && !navigator.mediaDevices?.getUserMedia) && (
							<button className="rb" title="Dictate (⌥V)" aria-label="Dictate" data-t="chat-mic" onClick={() => startRec("box")}>
								<Icon name="mic" />
							</button>
						)}
						<button
							className="rb primary"
							aria-label={label}
							title={label}
							data-t="chat-send"
							onClick={() => (mode === "stop" ? stop(card) : mode === "voice" ? startRec("send") : send())}
						>
							<Icon name={mode === "send" ? "up" : mode === "stop" ? "stop" : "wave"} />
						</button>
					</div>
				)}
				<input
					ref={file}
					type="file"
					multiple
					hidden
					onChange={(e) => {
						void upload([...(e.target.files || [])]);
						e.target.value = "";
					}}
				/>
			</div>
			{note !== undefined && <div className="foot-note desk-only">{note}</div>}
		</div>
	);
}

// ---------- recording ----------
type Recording = { mode: "box" | "send"; stop: () => Promise<Blob>; level: () => number; t0: number };
async function record(mode: "box" | "send"): Promise<Recording> {
	const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
	const chunks: Blob[] = [];
	const mr = new MediaRecorder(stream);
	mr.ondataavailable = (e) => e.data.size && chunks.push(e.data);
	const ctx = new AudioContext();
	const an = ctx.createAnalyser();
	an.fftSize = 512;
	ctx.createMediaStreamSource(stream).connect(an);
	const buf = new Uint8Array(an.fftSize);
	mr.start();
	return {
		mode,
		t0: Date.now(),
		level: () => {
			an.getByteTimeDomainData(buf);
			let peak = 0;
			for (const v of buf) peak = Math.max(peak, Math.abs(v - 128));
			return peak / 128;
		},
		stop: () =>
			new Promise((res) => {
				mr.onstop = () => {
					stream.getTracks().forEach((t) => t.stop());
					void ctx.close();
					res(new Blob(chunks, { type: mr.mimeType || "audio/webm" }));
				};
				mr.stop();
			}),
	};
}
function Bars({ rec }: { rec: Recording }) {
	const [bars, setBars] = useState<number[]>([]);
	const [secs, setSecs] = useState(0);
	useEffect(() => {
		const t = setInterval(() => {
			setBars((b) => [...b.slice(-159), Math.max(3, Math.min(28, rec.level() * 60))]);
			setSecs(Math.floor((Date.now() - rec.t0) / 1000));
		}, 80);
		return () => clearInterval(t);
	}, [rec]);
	return (
		<>
			<div className="bars">
				{bars.map((h, i) => (
					<i key={i} style={{ height: h }} />
				))}
			</div>
			<span className="tm">
				{Math.floor(secs / 60)}:{String(secs % 60).padStart(2, "0")}
			</span>
		</>
	);
}
