---
description: Synthesize the current investigation into a readable cited report
argument-hint: "[focus or question]"
---

Please output your full understanding of the current investigation.

Focus: $ARGUMENTS

Write a compact report that is easy to read and leads with the root of the issue: what we currently think is happening, why we think that, what we looked into, and what evidence supports it.

Main output requirements:

- Start with an `Overview` section.
- The overview should be a single super-readable paragraph, not a bullet list.
- Lead the paragraph with the root of the issue or likely conclusion before walking through the supporting investigation.
- Avoid heavy jargon. Use plain language that a smart reader can follow without rereading the whole conversation.
- Include the reasoning in the paragraph: what evidence mattered, how it connects, and why it points to the current conclusion.
- Include important uncertainty, assumptions, or open questions only if they matter to understanding the conclusion.
- Use inline numeric citations like `[1]`, `[2]`, `[3]` when referring to specific evidence.

Then include a lower `Sources` section:

- Use the same numeric labels from the overview.
- Each source should briefly explain the cited evidence in a little more detail.
- Sources may include file paths, commands, logs, docs, code chunks, URLs, or specific earlier findings from the conversation.
- Keep source explanations concise and useful.

Style constraints:

- Prioritize readability over exhaustiveness.
- Do not over-structure the main answer.
- Do not use a lot of bullets above the `Sources` section unless the situation truly needs it.
- Do not invent certainty. Clearly distinguish confirmed facts from likely explanations.

If no specific focus was provided, report on the full relevant context from the current conversation.
