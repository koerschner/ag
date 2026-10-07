// A chat's transcript: turns of a prompt, the work ("Worked for … · Explored 6 files, ran 3 commands", open while
// live) and the answer. Every turn, block and step is keyed by the server's stable item keys, so a refresh redraws
// only what changed, and what you opened stays open.
import { useContext, useEffect, useLayoutEffect, useRef, useState } from "react";
import { dur, tildify } from "../lib/format";
import { md } from "../lib/markdown";
import { buildTurns, diffOf, exploreCounts, groupSteps, KIND_ICON, parseArgs, stepKind, stepsDetail, type Block, type Row, type ToolItem, type Turn } from "../lib/turns";
import type { Media, Origin, TxItem } from "../lib/types";
import { Icon } from "./Icon";
import { copyText } from "../lib/clipboard";
import { FollowContext } from "./useScroll";

// Turns are rebuilt on every refresh; a turn whose items are the same objects as before is reused as is, so React
// skips it entirely.
type Built = Turn & { src: TxItem[]; live: boolean; open: boolean };
export function useTurns(items: TxItem[], working: boolean): Built[] {
	const prev = useRef(new Map<string, Built>());
	const turns = buildTurns(items, working);
	const out: Built[] = [];
	const next = new Map<string, Built>();
	let start = 0;
	for (const [i, t] of turns.entries()) {
		const n = (t.user ? 1 : 0) + t.blocks.reduce((k, b) => k + (b.kind === "steps" ? b.steps.length : 1), 0);
		const src = items.slice(start, start + n);
		start += n;
		const live = t.blocks.some((b) => b.kind === "steps" && b.live);
		const open = working && i === turns.length - 1; // the turn the agent is still in (its answer isn't final)
		const p = prev.current.get(t.key);
		const same = p && p.live === live && p.open === open && p.src.length === src.length && p.src.every((x, j) => x === src[j]);
		const b = same ? p : { ...t, src, live, open };
		out.push(b);
		next.set(t.key, b);
	}
	prev.current = next;
	return out;
}

export function Thread({ turns, txRef }: { turns: Built[]; txRef: string }) {
	return (
		<>
			{turns.map((t, i) => (
				<TurnView key={t.key} turn={t} last={i === turns.length - 1} txRef={txRef} />
			))}
		</>
	);
}

function TurnView({ turn, last, txRef }: { turn: Built; last: boolean; txRef: string }) {
	return (
		<div className="turn" data-turn={turn.key}>
			{turn.user && <UserMsg item={turn.user} />}
			{turn.blocks.map((b) => (
				<BlockView key={b.key} block={b} last={last} txRef={txRef} />
			))}
		</div>
	);
}

function UserMsg({ item }: { item: Extract<TxItem, { role: "user" }> }) {
	return (
		<div className="u" data-longpress="message">
			<Origins origins={item.origins} />
			<div className="bubble">
				{item.text}
				<MediaList list={item.media} />
			</div>
			<div className="actions">
				<CopyButton text={item.text} label="Copy message" />
				<button title="Edit in message box" aria-label="Edit message" data-edit={item.text}>
					<Icon name="pencil" />
				</button>
			</div>
		</div>
	);
}

const ORIGIN_ICON: Record<string, string> = { follow: "↪", hint: "⇢", report: "↩", spawn: "↳", note: "✂", rule: "✂", tickler: "◷", comment: "✎", playbook: "▤", share: "⎘", screenshot: "▣", dash: "⧖" };
function Origins({ origins }: { origins?: Origin[] }) {
	if (!origins?.length) return null;
	return (
		<div className="origins">
			{origins.map((o, i) => (
				<span key={i} className="origin" title={[o.label, o.title].filter(Boolean).join(" ")}>
					{ORIGIN_ICON[o.kind] || "↪"} {o.label || o.kind}
					{o.title &&
						(o.sid ? (
							<>
								{" "}
								<a href={`/chat/${o.sid}`} data-go={`/chat/${o.sid}`}>
									{o.title}
								</a>
							</>
						) : (
							` ${o.title}`
						))}
				</span>
			))}
		</div>
	);
}

export function MediaList({ list }: { list?: Media[] }) {
	if (!list?.length) return null;
	return (
		<div className="media">
			{list.map((m) =>
				m.kind === "video" ? (
					<video key={m.src} src={m.src} preload="metadata" muted playsInline data-zoom title={m.name} />
				) : (
					<img key={m.src} src={m.src} alt={m.name} loading="lazy" data-zoom />
				),
			)}
		</div>
	);
}

export function Markdown({ text, className = "md" }: { text: string; className?: string }) {
	return <div className={className} dangerouslySetInnerHTML={{ __html: md(text) }} />;
}

function CopyButton({ text, label }: { text: string; label: string }) {
	const [done, setDone] = useState(false);
	return (
		<button
			title="Copy"
			aria-label={label}
			data-t="chat-copy"
			onClick={() =>
				copyText(text).then(() => {
					setDone(true);
					setTimeout(() => setDone(false), 1500);
				})
			}
		>
			<Icon name={done ? "check" : "copy"} />
		</button>
	);
}

function SpeakButton({ text }: { text: string }) {
	const [on, setOn] = useState(false);
	useEffect(() => () => void (on && speechSynthesis.cancel()), [on]);
	return (
		<button
			title="Read aloud"
			aria-label="Read aloud"
			data-t="chat-speak"
			data-speak
			onClick={() => {
				speechSynthesis.cancel();
				if (on) return setOn(false);
				const u = new SpeechSynthesisUtterance(text.replace(/```[\s\S]*?```/g, " (code) ").replace(/[#*`>_|]/g, ""));
				u.onend = () => setOn(false);
				setOn(true);
				speechSynthesis.speak(u);
			}}
		>
			<Icon name={on ? "stop" : "speaker"} />
		</button>
	);
}

function BlockView({ block: b, last, txRef }: { block: Block; last: boolean; txRef: string }) {
	if (b.kind === "error") return <div className="err">{b.text}</div>;
	if (b.kind === "answer")
		return (
			<div className={`a${last && b.last ? " last" : ""}`} data-longpress="message">
				<Markdown text={b.item.text} />
				<MediaList list={b.item.media} />
				<div className="actions">
					<CopyButton text={b.item.text} label="Copy response" />
					<SpeakButton text={b.item.text} />
				</div>
			</div>
		);
	return <Steps block={b} txRef={txRef} />;
}

// What you opened or closed by hand stays that way (per chat and block) across refreshes and chat switches.
const toggled = new Map<string, boolean>();
function Steps({ block: b, txRef }: { block: Extract<Block, { kind: "steps" }>; txRef: string }) {
	const id = `${txRef}|${b.key}`;
	const [open, setOpen] = useState<boolean>(toggled.get(id) ?? b.live);
	const ref = useRef<HTMLDetailsElement>(null);
	const follow = useContext(FollowContext);
	// Steps open themselves while the turn runs and fold away when it ends, unless you opened or closed them by hand,
	// or you're scrolled up reading (folding would pull the page out from under you; they stay open then).
	useEffect(() => {
		if (!toggled.has(id) && (b.live || follow?.current !== false)) setOpen(b.live);
	}, [b.live, id, follow]);
	const { detail, thoughtOnly } = stepsDetail(b.steps);
	const span = b.startTs && b.endTs ? b.endTs - b.startTs : 0;
	return (
		<details
			ref={ref}
			className="steps"
			open={open}
			onToggle={(e) => {
				const o = e.currentTarget.open;
				if (o !== open) (toggled.set(id, o), setOpen(o));
			}}
		>
			<summary>
				{b.live ? (
					<span className="t shimmer">
						Working{b.startTs ? <> for <Elapsed since={b.startTs} /></> : "…"}
					</span>
				) : (
					<span className="t">{span > 1500 ? `${thoughtOnly ? "Thought" : "Worked"} for ${dur(span)}` : thoughtOnly ? "Thought for a moment" : "Worked"}</span>
				)}
				{detail && <span className="n">· {detail}</span>}
				<Icon name="chev" />
			</summary>
			{open && (
				<div className="step-list">
					{groupSteps(b.steps).map((r) => (
						<StepRow key={"group" in r ? r.key : r.k} row={r} live={b.live} />
					))}
				</div>
			)}
		</details>
	);
}

export function Elapsed({ since }: { since: number }) {
	const [, tick] = useState(0);
	useEffect(() => {
		const t = setInterval(() => tick((n) => n + 1), 1000);
		return () => clearInterval(t);
	}, []);
	return <>{dur(Date.now() - since)}</>;
}

function StepIcon({ kind, running, bad }: { kind: keyof typeof KIND_ICON; running?: boolean; bad?: boolean }) {
	if (running)
		return (
			<span className="ic">
				<span className="spin" />
			</span>
		);
	if (bad)
		return (
			<span className="ic bad">
				<Icon name="alert" />
			</span>
		);
	return (
		<span className="ic">
			<Icon name={KIND_ICON[kind]} />
		</span>
	);
}

function StepRow({ row, live }: { row: Row; live: boolean }) {
	if ("group" in row) {
		const tools = row.group.filter((y): y is ToolItem => y.role === "tool");
		const running = live && tools.some((y) => !y.result);
		const failed = tools.filter((y) => y.result?.error).length;
		return (
			<div className="srow">
				<StepIcon kind="explore" running={running} bad={!running && failed > 0} />
				<div className="body">
					<details className="step grp">
						<summary>
							<span className="what">
								{running ? "Exploring" : "Explored"} {exploreCounts(row.group)}
							</span>
							{failed > 0 && <span className="tag bad">{failed} failed</span>}
						</summary>
						<div className="sub">{row.group.map((y) => (y.role === "tool" ? <ToolStep key={y.k} x={y} /> : <Think key={y.k} text={(y as any).text} />))}</div>
					</details>
				</div>
			</div>
		);
	}
	const kind = stepKind(row);
	const tool = row.role === "tool" ? row : null;
	return (
		<div className="srow">
			<StepIcon kind={kind} running={live && !!tool && !tool.result} bad={!!tool?.result?.error} />
			<div className="body">{kind === "think" ? <Think text={(row as any).text} /> : kind === "note" ? <Markdown text={(row as any).text} className="step note md" /> : <ToolStep x={tool!} />}</div>
		</div>
	);
}

// Thinking reads as a muted two-line preview; click to read it all (only when it's actually cut off).
function Think({ text }: { text: string }) {
	const [clamp, setClamp] = useState(true);
	const [more, setMore] = useState(false);
	const ref = useRef<HTMLDivElement>(null);
	useLayoutEffect(() => {
		const el = ref.current;
		if (el) setMore(!clamp || el.scrollHeight > el.clientHeight + 1);
	}, [clamp, text]);
	return (
		<div
			ref={ref}
			className={`think md${clamp ? " clamp" : ""}${more ? " more" : ""}`}
			onClick={(e) => more && !(e.target as Element).closest("a") && !getSelection()?.toString() && setClamp(!clamp)}
			dangerouslySetInnerHTML={{ __html: md(text) }}
		/>
	);
}

const DEFAULT_HOST = "ag-engine";
function ToolStep({ x }: { x: ToolItem }) {
	const [open, setOpen] = useState(false);
	const kind = stepKind(x);
	const label = x.sum || `${x.name}${x.detail ? `: ${x.detail}` : ""}`;
	const host = (x.hosts || [])[0];
	const d = kind === "edit" ? diffOf(x) : null;
	return (
		<details className="step" onToggle={(e) => setOpen(e.currentTarget.open)}>
			<summary>
				{host && host !== DEFAULT_HOST && <span className="host">{host}</span>}
				<span className="what" title={x.detail || ""}>
					{label}
				</span>
				{x.result?.error ? (
					<span className="tag bad">failed</span>
				) : d ? (
					<span className="tag">
						<span className="add">+{d.add}</span> <span className="del">−{d.del}</span>
					</span>
				) : null}
			</summary>
			{open && <ToolBody x={x} diff={d} />}
		</details>
	);
}

function ToolBody({ x, diff }: { x: ToolItem; diff: ReturnType<typeof diffOf> }) {
	const res = x.result;
	if (diff)
		return (
			<>
				<div className="diff">
					<div className="f">{tildify(diff.path)}</div>
					{diff.hunks.map((h, i) => (
						<div key={i}>
							{i > 0 && <div className="gap" />}
							{h.map((l, j) => (
								<div key={j} className={`l ${l.cls}`}>
									{l.cls === "add" ? "+" : "−"} {l.text}
								</div>
							))}
						</div>
					))}
					{diff.more > 0 && <div className="f">… {diff.more} more lines</div>}
				</div>
				{res?.error && <pre>{res.text}</pre>}
			</>
		);
	if (x.name === "bash") {
		const cmd = parseArgs(x)?.command || x.detail || "";
		return (
			<>
				<div className="term">
					<div className="cmd">{cmd}</div>
					{res && <div className={`out${res.error ? " bad" : ""}`}>{res.text || "(no output)"}</div>}
				</div>
				<MediaList list={res?.media} />
			</>
		);
	}
	return (
		<>
			<pre>{x.args || x.detail || ""}</pre>
			{res && <pre>{res.text || "(no output)"}</pre>}
			<MediaList list={res?.media} />
		</>
	);
}

