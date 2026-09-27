## Herdr (terminal multiplexer)

<!-- include: herdr.md -->

Never create a git commit without consulting the user first and receiving explicit approval.

Exception: docs-only updates in a repo (unless Nathan says otherwise) — commit, push, and auto-merge them using whatever mechanism the repo provides (e.g. arcade's `bun run sync docs`, which opens a `docs/*` PR that `docs-automerge.yml` squash-merges) without asking.

Exception: dotfiles (each machine's checkout; see `machines/README.md`) is fully slop-cannon. Whenever you change anything in it, immediately commit and push/merge to `main` without asking, then pull and apply on every machine (see "Machine setup lives in dotfiles"). Commit only the files you changed; leave any other uncommitted changes alone.

Exception: **"Run it"** (see below) grants standing approval to commit, push, open PRs, and merge for that task.
