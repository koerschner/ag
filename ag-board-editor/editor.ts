// AG Dash's prompt editor: CodeMirror 6 with optional vim bindings.
// Built into ../ag-board/dot-local/share/ag-board/editor.js with `bun run build` (the bundle is committed,
// so machines don't need to build it). The page imports it from /static/editor.js.
//
//   const ed = createEditor(parent, { placeholder, vim, onSubmit, onMode, onPasteFiles })
//   ed.value / ed.setValue(s) / ed.insert(s) / ed.focus() / ed.setVim(bool) / ed.setPlaceholder(s)
// No soft wrapping: long lines scroll sideways, so j/k and the arrows move by real lines.
// Submit: ⌘↩ / Ctrl+↩ in any mode, or :q / :wq / :x in vim. :w only saves (onSave) and stays in NORMAL mode. Esc in insert mode goes to normal mode (vim) and
// never bubbles out to close the drawer. Vim starts in NORMAL mode, like nvim; `jk` also leaves insert mode.
// Browser extensions like Vimium grab Esc before the page and blur the field; a blur with no click/tap behind
// it is treated as that Esc: the editor takes focus back and goes to NORMAL mode.
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { Compartment, EditorState, Prec } from "@codemirror/state";
import { EditorView, keymap, placeholder as placeholderExt, drawSelection } from "@codemirror/view";
import { getCM, vim, Vim } from "@replit/codemirror-vim";
import { tags } from "@lezer/highlight";

type Opts = {
	placeholder?: string;
	vim?: boolean;
	onSubmit?: () => void;
	onSave?: () => void;
	onMode?: (mode: string) => void;
	onPasteFiles?: (files: File[]) => void;
};

const theme = EditorView.theme(
	{
		"&": { background: "#1f2228", color: "#e7e9ee", borderRadius: "8px", border: "1px solid #2e333b", fontSize: "13.5px" },
		"&.cm-focused": { outline: "none", borderColor: "#5aa2ff" },
		".cm-content": { padding: "8px 4px", fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", caretColor: "#e7e9ee" },
		".cm-scroller": { maxHeight: "34vh", minHeight: "2.8rem", overflow: "auto" },
		".cm-placeholder": { color: "#6b717c" },
		".cm-cursor": { borderLeftColor: "#e7e9ee" },
		".cm-fat-cursor": { background: "#5aa2ff88 !important" },
		"&:not(.cm-focused) .cm-fat-cursor": { background: "none !important", outline: "1px solid #5aa2ff" },
		".cm-selectionBackground, &.cm-focused .cm-selectionBackground": { background: "#2d4a73 !important" },
		".cm-panels": { background: "#15171b", color: "#e7e9ee" },
		".cm-vim-panel input": { color: "#e7e9ee", fontFamily: "ui-monospace, monospace" },
	},
	{ dark: true },
);
const highlight = HighlightStyle.define([
	{ tag: tags.heading, color: "#cdb6ff", fontWeight: "600" },
	{ tag: tags.strong, fontWeight: "700" },
	{ tag: tags.emphasis, fontStyle: "italic" },
	{ tag: tags.monospace, color: "#a9c8ff" },
	{ tag: tags.link, color: "#7ab4ff" },
	{ tag: tags.url, color: "#7ab4ff" },
	{ tag: tags.list, color: "#f5b33b" },
	{ tag: tags.quote, color: "#8b919c" },
]);

// :q / :wq / :x submit the editor they're typed in; :w just saves the draft (Nathan: only q sends).
let exDefined = false;
let lastPointer = 0;
function defineEx() {
	if (exDefined) return;
	exDefined = true;
	for (const ev of ["mousedown", "touchstart", "pointerdown"]) document.addEventListener(ev, () => (lastPointer = Date.now()), true);
	Vim.map("jk", "<Esc>", "insert");
	const submit = (cm: any) => cm.cm6?.dom?.dispatchEvent(new CustomEvent("ag-submit"));
	Vim.defineEx("write", "w", (cm: any) => cm.cm6?.dom?.dispatchEvent(new CustomEvent("ag-save")));
	Vim.defineEx("wq", "wq", submit);
	Vim.defineEx("x", "x", submit);
	Vim.defineEx("quit", "q", submit); // :q sends too (Nathan's habit)
}

export function createEditor(parent: HTMLElement, opts: Opts = {}) {
	defineEx();
	const vimC = new Compartment();
	const phC = new Compartment();
	const submitKeys = Prec.highest(
		keymap.of([
			{ key: "Mod-Enter", run: () => (opts.onSubmit?.(), true) },
			{ key: "Ctrl-Enter", run: () => (opts.onSubmit?.(), true) },
		]),
	);
	const view = new EditorView({
		parent,
		state: EditorState.create({
			doc: "",
			extensions: [
				vimC.of(opts.vim ? vim({ status: true }) : []),
				submitKeys,
				history(),
				drawSelection(),
				keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
				markdown(),
				syntaxHighlighting(highlight),
				phC.of(placeholderExt(opts.placeholder ?? "")),
				theme,
				EditorView.domEventHandlers({
					paste(e) {
						const files = [...(e.clipboardData?.files ?? [])];
						if (files.length && opts.onPasteFiles) {
							e.preventDefault();
							opts.onPasteFiles(files);
							return true;
						}
						return false;
					},
					drop(e) {
						const files = [...(e.dataTransfer?.files ?? [])];
						if (files.length && opts.onPasteFiles) {
							e.preventDefault();
							opts.onPasteFiles(files);
							return true;
						}
						return false;
					},
				}),
			],
		}),
	});
	view.dom.addEventListener("ag-submit", () => opts.onSubmit?.());
	view.dom.addEventListener("ag-save", () => opts.onSave?.());
	// Keep Escape inside the editor (vim uses it; it must not close the drawer).
	view.dom.addEventListener("keydown", (e) => {
		if (e.key === "Escape") e.stopPropagation();
	});
	const hookMode = () => {
		const cm = getCM(view);
		if (!cm) return opts.onMode?.("");
		opts.onMode?.("NORMAL");
		cm.on("vim-mode-change", (e: any) => opts.onMode?.(String(e.mode).toUpperCase() + (e.subMode ? ` ${e.subMode.toUpperCase()}` : "")));
	};
	// Esc stolen by an extension (Vimium blurs the field): refocus and go to NORMAL mode instead.
	view.contentDOM.addEventListener("blur", (e) => {
		const cm = getCM(view);
		if (!cm || (e as FocusEvent).relatedTarget || Date.now() - lastPointer < 400) return;
		setTimeout(() => {
			if (!document.hasFocus() || document.activeElement !== document.body) return; // switched apps / moved focus on purpose
			view.focus();
			if (cm.state.vim?.insertMode) Vim.handleKey(cm, "<Esc>", "mapping");
		}, 0);
	});
	if (opts.vim) queueMicrotask(hookMode);

	return {
		view,
		get value() {
			return view.state.doc.toString();
		},
		setValue(s: string) {
			view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: s }, selection: { anchor: s.length } });
		},
		insert(s: string) {
			const { from, to } = view.state.selection.main;
			view.dispatch({ changes: { from, to, insert: s }, selection: { anchor: from + s.length } });
		},
		focus() {
			view.focus();
		},
		setVim(on: boolean) {
			view.dispatch({ effects: vimC.reconfigure(on ? vim({ status: true }) : []) });
			if (on) queueMicrotask(hookMode);
			else opts.onMode?.("");
		},
		setPlaceholder(s: string) {
			view.dispatch({ effects: phC.reconfigure(placeholderExt(s)) });
		},
	};
}
