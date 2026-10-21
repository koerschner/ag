---
description: Weekly: attach receipts and memos to the user's Ramp card charges before Ramp locks the card
schedule: weekly Mon 09:37
kind: prompt
cwd: ~
timeout: 60min
enabled: true
---
Goal: the user's Ramp card (the work card; account details are in ~/AGENTS.md, "About the user") has no
transactions with missing items, so Ramp never locks it. Ramp requires a receipt and a memo on every charge and
locks the card after 7 days of incomplete items. The user is a cardholder, not a Ramp admin (no API access), so
this runs through computer use on ag-mac (`ag cua`, the `ag_cua` tool), in Chrome's Default profile, which is
signed in to the user's work Google account, their personal Gmail, and Ramp (app.ramp.com, via work Google).

1. Check ag-mac is up (`ag-mac status`). If it's unreachable, text the user (step 5) and stop.
2. One `ag cua` run, read-only: open Ramp, filter expenses to "Submission policy status → Missing items", and
   list each transaction (date, merchant, amount, link, what is missing). Note any lock warning and its date.
   If Ramp or work Gmail says "Session expired" or asks for a password, stop: never type a Google password;
   text the user that they need to sign back in on ag-mac. If nothing is missing, go to step 5.
3. For each transaction missing a receipt, one `ag cua` run per merchant (or a few together):
   a. Look for the receipt email in work Gmail, then personal Gmail (merchant name, amount, a few days around
      the date). If found, forward it to receipts@ramp.com from that mailbox (both addresses are verified
      senders in Ramp) and wait a few minutes for Ramp to match it.
   b. Otherwise sign in to the merchant's billing page (most work subscriptions use the work account: "Continue
      with Google" or an emailed code read from Gmail) and download the invoice for that exact amount.
      Chrome asks where to save every download: answer the macOS Save dialog (save to ~/Downloads as
      `<Merchant>-<YYYY-MM-DD>-<amount>.pdf`); if no file appears, print the invoice page to PDF instead.
      Upload it on the Ramp transaction page.
   c. Never type passwords into the CUA task text, and only use `ag-type-secret op://…` for a field you've
      confirmed is that site's password field. Never buy, cancel, upgrade, or change a subscription or a setting.
   If a memo is missing, write a short factual business-purpose memo in the style of earlier ones (e.g. "<Product>
   subscription for <what it's used for> in building AI-powered education products"); if Ramp shows a suggested
   memo, accept it as is. Don't touch category, accounting fields, or approvals.
4. Verify with a final `ag cua` read: reload each transaction (receipt attached, memo saved) and re-check the
   Missing items filter and the lock warning.
5. Tell the user only when it matters, with `ag-text` (one or two lines): what was fixed, and anything still
   missing with the reason (merchant needs a login, no invoice found, ag-mac down, session expired) and the
   lock date. If nothing was missing, don't text.

Ramp's to-do list is the source of truth; don't act on old Ramp emails (e.g. a purchase verification that no
longer appears in Ramp). Times in Central.

RESULT summary: "missing before N ($X), fixed M, still missing K: <merchants + reason>; lock warning: <date|none>".
