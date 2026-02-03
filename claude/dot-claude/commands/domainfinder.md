---
allowed-tools: Bash(dotchk:*)
argument-hint: <name>
description: Check domain availability for a name across variations and TLDs
---

## Your Task

Check domain availability for **$ARGUMENTS** across different variations including prefixes, suffixes, and top-level domains.

## Variations to Check

### Top-Level Domains
Check the base name with these TLDs:
- `.com`, `.io`, `.ai`, `.co`, `.dev`, `.app`, `.net`, `.org`

### Common Prefixes
Prepend these directly to the name (no dashes) with `.com`:
- `get`, `try`, `use`, `go`, `hey`, `with`, `meet`

Example: for "acme" → `getacme.com`, `tryacme.com`, etc.

### Common Suffixes
Append these directly to the name (no dashes) with `.com`:
- `hq`, `app`, `io`, `labs`, `dev`, `hub`, `now`

Example: for "acme" → `acmehq.com`, `acmeapp.com`, etc.

## Process

1. Build the full list of domain variations
2. Check all domains at once using `dotchk`:
   ```
   dotchk name.com name.io getname.com namehq.com ...
   ```
3. Present results organized by availability

## Output Format

Only show **available** domains:

| Domain | Type |
|--------|------|
| example.io | TLD variation |
| getexample.com | Prefix |

Do not list unavailable domains.

## Requirement

**Keep searching until you find at least 10 available domains.**

If the initial batch doesn't yield 10 available options, try additional variations:
- More TLDs: `.sh`, `.so`, `.to`, `.me`, `.xyz`, `.gg`, `.run`
- More prefixes: `my`, `the`, `join`, `hello`, `our`
- More suffixes: `ly`, `ify`, `er`, `ing`, `up`, `on`, `ai`
- Combine prefix + suffix: `getnamehq.com`, `trynameapp.com`

Continue expanding variations until you have 10 available domains to present.
