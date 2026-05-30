---
name: add-skill
description: Explain and execute how to add a new global or repo-local skill
argument-hint: "[skill-name] [optional: short purpose]"
---

Help me add a skill correctly in my setup. Always distinguish between:

1. **Global skills (dotfiles-managed)**: shared across Claude, Codex, and Agents on any machine after stowing dotfiles.
2. **Repo skills (project-local)**: only available inside the current repo for Pi/Agents to use.

## First: Determine scope (default to global)

Assume **global skill** unless the user explicitly asks for a repo-local skill.

If the user does not specify scope:
- Proceed as **global**.
- Confirm skill name and purpose only.

If the user explicitly requests repo-local behavior, follow the repo workflow below.

---

## A) Global skill workflow (dotfiles)

### Architecture to follow

Global skills live in:
- `~/dotfiles/agent-skills/_shared-skills/<skill-name>/SKILL.md`

Agent entry points:
- `~/.codex/skills` -> stowed from `~/dotfiles/codex/dot-codex/skills` (symlink to shared skills)
- `~/.agents/skills` -> stowed from `~/dotfiles/codex/dot-agents/skills` (symlink to shared skills)
- `~/.claude/commands` -> stowed from `~/dotfiles/claude/dot-claude/commands` (single symlink to `~/dotfiles/agent-skills/_claude-commands`)
- `~/.claude/commands/<skill-name>.md` -> `~/dotfiles/agent-skills/_claude-commands/<skill-name>.md` -> shared `SKILL.md`

### Steps

1. Create skill directory and file:
   - `~/dotfiles/agent-skills/_shared-skills/<skill-name>/SKILL.md`
2. Add frontmatter with at least:
   - `name`, `description` (and optional `argument-hint`, `allowed-tools`)
3. If Claude should have it, add shim symlink in:
   - `~/dotfiles/agent-skills/_claude-commands/<skill-name>.md` -> `../_shared-skills/<skill-name>/SKILL.md`
4. Re-stow packages from `~/dotfiles`:
   - `stow claude codex`
5. Verify resolution:
   - `~/.claude/commands/<skill-name>.md` exists
   - `~/.codex/skills/<skill-name>/SKILL.md` exists
   - `~/.agents/skills/<skill-name>/SKILL.md` exists

---

## B) Repo skill workflow (project-local)

Use this when a skill should only exist for one repository.

1. Create skill file in the repo’s local skills area (typically):
   - `<repo>/skills/<skill-name>/SKILL.md`
2. Add frontmatter and instructions specific to that project.
3. Do **not** add a dotfiles Claude shim.
4. Do **not** stow dotfiles for repo-only skills.
5. Verify Pi can discover it from the repo context.

---

## Output expectations when I invoke this skill

- State clearly whether we are creating a **global** or **repo** skill.
- If scope was not specified, explicitly note that **global** was assumed by default.
- Show exact paths that will be created/edited.
- For global skills, include stow + verification commands.
- For repo skills, confirm this is intentionally local-only.
