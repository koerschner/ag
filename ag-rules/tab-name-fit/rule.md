---
description: A session's tab is renamed when its label no longer names what the session is about
on: tab-name
code: rule.ts
enabled: true
---
After each prompt, check whether the tab's label still names what the session as a whole is about: the topic
that runs through it (usually set by the first prompt), not its latest step. Keep it when it's likely accurate
(p ≥ 0.5); rename it when it names a different topic, has a misleading key word, names only a generic step
("PR Review", "Fix Bug"), or the session has clearly moved on to an unrelated task for good. Labels I set by hand
are never touched (that's the tab namer's own rule, not this one).

Code: one Jev choice (accurate / wrong_topic / misleading_word / generic_step / switched) on the label, the
first prompt and a spread of later ones; keep when P(accurate) ≥ 0.5. The new name comes from the tab namer's
fast LLM.
