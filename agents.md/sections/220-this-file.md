## This file

This is the single global agent instructions file, `pi/dot-pi/agent/AGENTS.md` in the ag checkout (`~/ag`). Pi (`~/.pi/agent/AGENTS.md`), Claude Code (`~/.claude/CLAUDE.md`) and Codex (`~/.codex/AGENTS.md`) all symlink to it.

It is generated from `agents.md/` in the ag checkout: one file per top-level section in `agents.md/sections/` (concatenated in filename order, so renumber to reorder), and longer docs in `agents.md/includes/` (such as `attribution.md` and `herdr.md`) pulled in by `<!-- include: NAME.md -->`. Edit those, then run `agents.md/build`. Add a new section as a new numbered file rather than growing an existing one. Never edit the generated file or a copy of it: a rebuild overwrites it (a pre-commit hook in `.githooks/` rejects commits where it's stale).
