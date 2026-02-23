## Environment
- Configuration files are stored in `~/dotfiles/claude/dot-claude/` and symlinked to `~/.claude/` via `cd ~/dotfiles && stow claude`.

## Python
- Always use `uv` for Python project management (virtual environments, dependencies, and Python version management).
- Use `uv init` for new projects, `uv add` for dependencies, and `uv run` to execute scripts.
- Never install packages globally or use raw pip/venv.
