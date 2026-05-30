---
name: review
description: Run the reviewer sub-agent for code review
argument-hint: "[target or extra review instructions] [optional: --provider <provider> --model <model>]"
allowed-tools: bash
---

Spawn the Pi `reviewer` sub-agent via bash and have it perform the review.

Run:

`pi --print ...`

Behavior:

1. Pass through user arguments (`$@`) to the sub-agent invocation.
2. If the user specifies a model, include `--provider` and `--model` accordingly.
3. Give the sub-agent a prompt telling it to review code for:
   - Bugs and logic errors
   - Security issues
   - Error handling gaps
4. Do **not** read code yourself; the sub-agent must do the code inspection.
5. Return the sub-agent findings to the user.
