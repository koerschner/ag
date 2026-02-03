---
allowed-tools: Bash(dotchk:*)
argument-hint: <project description>
description: Generate creative project names and check .com domain availability
---

## Your Task

Generate creative project/company names for the following concept, then check which .com domains are available.

**Project Description:** $ARGUMENTS

## Name Generation Guidelines

Generate **15-20 unique names** across these styles:

1. **Short & Catchy** (5-7 names): Single words or portmanteaus (like Stripe, Slack, Notion)
2. **Two-Word Combos** (4-5 names): Word pairs (like DigitalOcean, CloudFlare)
3. **Made-Up Words** (4-5 names): Invented/coined names (like Figma, Vercel, Twilio)
4. **Abstract/Metaphorical** (2-3 names): Names that evoke feeling without being literal
5. **Greek and Latin root words** (3-4 names): Names that are compounds of greek and latin roots (like Opterra)

## Requirements

- Names should be **memorable, easy to spell, and easy to pronounce**
- Prefer names **12 characters or fewer** when possible
- Avoid hyphens, numbers, or unusual characters
- Consider the target audience and brand positioning
- avoid x in the name, avoid "ova" and "wyn"

## Process

1. First, brainstorm and list all name candidates
2. Then check .com, .io, and .ai availability using `dotchk` for ALL names at once:
   ```
   dotchk name1.com name2.com name3.com ...
   ```
3. Present results in a clear table format:
   - Available domains (highlight these!)

## Output Format

Present a summary table showing:
| Name | .com Status | Style | Notes |
|------|-------------|-------|-------|

Highlight the **available** domains prominently and provide 2-3 sentences on why each available name could work well for the project.
