---
name: add-skill
description: Explain and execute how to add a new global or repo-local skill
argument-hint: "[skill-name] [optional: short purpose]"
---

Help me add a skill correctly in my setup. Always distinguish between:

1. **Global skills (ag-managed)**: shared across Pi, Claude, and Codex on every machine after stowing the ag repo.
2. **Repo skills (project-local)**: only available inside the current repo for Pi/Agents to use.

## First: Determine scope (default to global)

Assume **global skill** unless the user explicitly asks for a repo-local skill.

If the user does not specify scope:
- Proceed as **global**.
- Confirm skill name and purpose only.

If the user explicitly requests repo-local behavior, follow the repo workflow below.

---

## A) Global skill workflow (ag repo)

### Architecture to follow

Global skills live in the ag repo (`~/ag`):
- `~/ag/agents/dot-agents/skills/<skill-name>/SKILL.md`, stowed (package `agents`) to `~/.agents/skills/<skill-name>/SKILL.md`, which Pi loads (`"skills": ["~/.agents/skills"]` in its `settings.json`).
- Claude and Codex get a skill through a relative symlink in their packages: `~/ag/claude/dot-claude/skills/<skill-name>` and `~/ag/codex/dot-codex/skills/<skill-name>` -> `../../../agents/dot-agents/skills/<skill-name>`.

### Steps

1. Create `~/ag/agents/dot-agents/skills/<skill-name>/SKILL.md` with frontmatter: at least `name` and `description` (optional `argument-hint`, `allowed-tools`).
2. If Claude/Codex should have it, add the two symlinks above.
3. Restow: `stow --dotfiles --no-folding -d ~/ag -t ~ agents claude codex`.
4. Verify `~/.agents/skills/<skill-name>/SKILL.md` (and `~/.claude/skills/…`, `~/.codex/skills/…`) resolve.
5. Commit and push ag, then sync every machine (see the `dotfiles-change` skill).

---

## B) Repo skill workflow (project-local)

Use this when a skill should only exist for one repository.

1. Create skill file in the repo’s local skills area (typically):
   - `<repo>/skills/<skill-name>/SKILL.md`
2. Add frontmatter and instructions specific to that project.
3. Do **not** add anything to the ag repo for repo-only skills.
4. Verify Pi can discover it from the repo context.

---

## Output expectations when I invoke this skill

- State clearly whether we are creating a **global** or **repo** skill.
- If scope was not specified, explicitly note that **global** was assumed by default.
- Show exact paths that will be created/edited.
- For global skills, include stow + verification commands.
- For repo skills, confirm this is intentionally local-only.
