---
name: consent-deliverability
description: Triage a FreeTime / Arcade parental-consent support case, such as "my mom never got the email", "the approval link loops", "codes never come", "it says I'm a different parent", or a help-desk ticket about a parent who can't approve. It traces the case end to end (ask → email/SMS delivery → link opens → school guardian verification → codes → decision), names the root cause (data, delivery, verification UX, or our bug), and routes the fix to the right owner with an attributed message. Use for any single-family consent problem; for bulk consent campaigns, use the consent work in the arcade repo instead.
---

# Consent deliverability triage

One family can't get a parental consent through. Find **where in the chain it stopped**, prove it with rows and traces, and hand the fix to whoever owns that link of the chain. Don't guess from the ticket text: ticket summaries and support-bot replies often undercount (e.g. "2 codes" when 5 were sent and delivered).

**Read the private runbook first:** `~/ag-personal/notes/consent-deliverability.md`. It has the databases, tables, queries, Honeycomb fields, people and routing, plus past cases. This public file is only the method.

## Hard rules

- **Never fabricate or force consent.** Don't insert or flip consent, decision or verification rows to "approve" a family, even when the parent clearly wants it and even under "Run it". A recorded consent claims the parent was verified. If no legitimate path works, that's a question for legal (see the runbook), not a DB write.
- **Read-only first.** The partner school's database is read-only to us. Arcade prod writes are only for clearly broken *state* (a stuck row the code can't recover from), never for outcomes, and only after showing the user the exact SQL.
- **Data fixes on the school side belong to the school.** Write up the exact change (which record, which field, from what to what) and route it. Don't work around it in our data.
- **Times in Central** with a relative day (the sources are UTC).
- Anything sent to another person follows the AI attribution rule.

## Method

Build one timeline for the family, in this order. Each step either clears that link of the chain or is the root cause.

1. **Identify.** Student(s) on our side (users by email or name) → their school roster id → the guardian id the ask was sent to. Every sibling counts: they often share one guardian and one stuck state.
2. **Asks.** Our consent requests for each child: created, expires, opened, school check started, verified, blocker. An unopened request means look at delivery. An opened but unverified one means look at verification.
3. **Delivery.** Our delivery ledger (email + SMS attempts and outcomes), the school's SMS request log, and the school's message thread for that phone (per-message delivery status). Note that some SMS providers never report delivery: "sent" with no receipt is normal there, and an open seconds later proves arrival.
4. **Data match.** Compare the guardian on the roster (email) with the school's parent record (email, phone, linked login, roster id). Look for: guardian attached to the wrong parent record, a parent record with no login, duplicate parent records, no mobile on file, SMS opt-out.
5. **Verification.** Our verification attempts (status, end reason) and the school's matching rows (status, codes sent, code failures, bound login, verified/exchanged). Then the school login's identities (new identities created mid-flow mean the parent re-signed in).
6. **Page behavior.** Honeycomb, filtered to the consent request id: page loads, milestones (engaged, continue clicked, redirected, return error and its reason). This is what tells "the page broke" apart from "the parent kept going back to the link and starting over".
7. **Parent's words.** The school's SMS thread for that phone usually has the parent's own message and the support bot's reply. Check the reply against the facts.

## Classify the root cause

| Class | Typical evidence | Owner |
|---|---|---|
| **School data** | Guardian on the wrong parent record, no linked login, duplicates, no mobile, opt-out | School (data fix), then re-send the asks |
| **Delivery** | Bounces, SMS failures, unopened asks with no delivery row | Whoever owns that carrier |
| **Verification UX** | Codes sent and delivered, 0 code attempts, repeated continue/redirect, cancel/expire | Parent guidance now; school owns their page, we own ours |
| **Our bug** | Error spans, stuck rows the code can't recover, wrong copy/links | Us: ticket in the arcade repo via `arcade-create-issue` |

State the class, the evidence (ids, counts, times), what unblocks this family now, and what would stop it for other families.

## Deliverables

1. **Findings for the user:** timeline, root cause, why no DB change (or the exact SQL if one is warranted), what unblocks the family.
2. **A parent-facing reply** when guidance unblocks them: short, step-by-step, plain words, labeled as a draft.
3. **The owner message** when someone else must act, posted where the runbook says (attributed, with ids so they can look it up, no raw phone numbers or codes). Then read it back.
4. Correct the record if the support bot or ticket told the parent something wrong.

If another session is already working the same family, coordinate instead of double-posting: send it your findings (`t3_thread_send` / `ag send`) and let one of you post.
