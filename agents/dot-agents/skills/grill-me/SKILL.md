---
name: grill-me
description: Interview the user to pin down what they actually want (the ends) and how to get there (the means) before acting, in short rounds of questions with a recommended answer for each. Use when the user says "grill me", "interview me", "stress-test this", or when a goal, plan, decision, or loose intention ("I should get better at X") is too vague to act on. Works on anything, not just code.
---

Interview the user until you share an understanding of the goal and the plan. Ask; don't build.

1. **Ends before means.** First settle what they want and why: the outcome, who it's for, what success looks like, and the binding constraint. Only then ask about how. If an answer sounds like what they *should* want ("best practice", "scalable", "I should probably…"), ask: "If you didn't have to justify this to anyone, what would you actually want?"
2. **Rounds, not a flood.** Map the decisions as a tree. Each round, ask only the questions whose prerequisites are already settled (usually 1–4), numbered, each with your recommended answer, worded so "yes" accepts it:

   ```
   ❓ **Q1 - <title>**: <question, with options if useful>
   ➡️ <your recommended answer>
   ```

   Wait for answers, then ask the next round. Questions that depend on an open answer wait for a later round.
3. **Facts are your job, decisions are theirs.** Look up anything you can (files, tools, the web) instead of asking. If a question can't be answered by talking ("how should this feel?"), say so and suggest a quick prototype or example to react to.
4. **Finish with a restatement**, in their words, for a line-by-line yes or correction:

   ```
   Outcome:      …
   Why:          …
   Success:      …
   Constraint:   …
   Means:        …
   Out of scope: …
   ```

   You're done when you could predict their answer to your next three questions. "Sounds good" or "whatever you think" isn't a yes: offer two concrete options instead. Don't act until they confirm.

---

_Adapted from Matt Pocock's [grilling](https://github.com/mattpocock/skills/tree/main/skills/productivity/grilling) (rounds, frontier, recommended answers) and Addy Osmani's [interview-me](https://github.com/addyosmani/agent-skills/tree/main/skills/interview-me) (want vs. should-want, the restatement, the stop test)._
