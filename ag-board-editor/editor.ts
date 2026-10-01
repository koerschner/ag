// AG Dash's prompt editor: CodeMirror 6 (markdown highlighting, history; no vim).
// Built into ../ag-board/dot-local/share/ag-board/editor.js with `bun run build` (the bundle is committed,
// so machines don't need to build it). The page imports it from /static/editor.js.
//
//   const ed = createEditor(parent, { placeholder, onSubmit, onPasteFiles })
//   ed.value / ed.setValue(s) / ed.insert(s) / ed.focus() / ed.setPlaceholder(s)
// Submit: ⌘↩ / Ctrl+↩. Pasted or dropped files go to onPasteFiles (the page uploads them and inserts their paths).
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { Compartment, EditorState, Prec } from "@codemirror/state";
import { EditorView, keymap, placeholder as placeholderExt, drawSelection } from "@codemirror/view";
import { tags } from "@lezer/highlight";

type Opts = {
	placeholder?: string;
	onSubmit?: () => void;
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
		".cm-selectionBackground, &.cm-focused .cm-selectionBackground": { background: "#2d4a73 !important" },
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

export function createEditor(parent: HTMLElement, opts: Opts = {}) {
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
				submitKeys,
				history(),
				drawSelection(),
				EditorView.lineWrapping, // long lines wrap instead of scrolling sideways
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
		setPlaceholder(s: string) {
			view.dispatch({ effects: phC.reconfigure(placeholderExt(s)) });
		},
	};
}
