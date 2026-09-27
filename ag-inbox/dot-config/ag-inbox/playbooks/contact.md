---
name: contact
when: The capture is mainly a person's contact details: a name with a phone number or email (typed, or a screenshot/photo of a contact card, business card, email signature, text thread, or profile), usually meaning "this is someone I just met or need to reach".
---
Nathan sent you someone's contact details. Run this workflow quickly and in order, then report.

1. **Extract** the name, phone (normalise to E.164, assume +1 if no country code), email, company/role, and where or how they met, from his text and any attached images. If key details are ambiguous, make your best reading and say so.
2. **Check existing contacts**: `client-people find "<name>"`, and again by phone and email. If the person already exists, don't create a duplicate; note what's new instead.
3. **Look them up.** Use the brave-search skill (and LinkedIn/company pages it finds) to work out who they are: current role and company, background, location, anything notable or relevant to Nathan's work (the Arcade / arcade.school, TSA, education, games, AI). Search on name plus any company, email domain, or city clue. Never state a guess as fact: give your confidence, and say if you couldn't find a confident match.
4. **Add to Contacts** (unless they already exist): `client-people add --first … --last … --phone … --email … --org … --note "<one line: how Nathan knows them / met them, date, plus the key lookup finding>"`. This runs on Nathan's client Mac and syncs to his phone via iCloud.
5. **Message them as Nathan**:
   - If Nathan's capture says what to send, or clearly asks you to text them ("text them", "send them my …", "follow up with …"), send it with `client-people text <phone or email> "<message>"`.
   - Otherwise, draft a short, warm first message in Nathan's voice (1–2 sentences, e.g. "Hey <first name>, it's Nathan — great meeting you at <place>. …") and ask him to reply "send" (or edit it). Send only after he confirms.
   - Either way Nathan explicitly asked for or approved this exact message in his own voice, so it goes out as him with no AI attribution line (the drafts-in-his-voice exception). Never mention internal names like "ag".
6. **Report** in a few lines: who they are (with confidence and 1–2 source links), what you added to Contacts, and the message sent or drafted.
