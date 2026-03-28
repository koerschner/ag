# PR Description Template

Use this template to generate PR descriptions. Fill in each section based on your analysis.

## Header Links

[{TICKET_ID}]({TICKET_URL})

## What problems was I solving

[Describe the user pain points or problems this PR addresses. What will be true or possible now that this is shipped? How will success be measured qualitatively and quantitatively?]

## What user-facing changes did I ship

[Bulleted list with GitHub diff permalinks to changed files]

- [{file_path}]({pr_url}/files#diff-{sha256_hash}) - [brief description of change]
- ...

## How I implemented it

[A journey through the PR with permalinks to file diffs and/or line diffs. Walk through the implementation chronologically or by component.]

### Database Changes
- [{migration_file}]({pr_url}/files#diff-{hash}) - [description]

### Backend Changes
- [{file}]({pr_url}/files#diff-{hash}R{line}) - [description of specific line/function]

### Frontend Changes
- [{file}]({pr_url}/files#diff-{hash}) - [description]

## Deviations from the plan

[If a plan file exists in the task directory, analyze the final code state compared to the plan. This section helps reviewers who already reviewed the plan understand the diff between what they read and what was actually implemented.]

### Implemented as planned
- [item]

### Deviations/surprises
- [item with explanation]

### Additions not in plan
- [item with rationale]

### Items planned but not implemented
- [item with reason]

## How to verify it

[Steps a reviewer could take to test this PR]

### Setup
```bash
git fetch
scripts/create_worktree.sh {branch_name}
cd ~/wt/synclayer/{worktree_dir_name}
```

### Manual Testing
- [ ] [verification step 1]
- [ ] [verification step 2]

### Automated Tests
```bash
bun run typecheck
bun run test
```

## Description for the changelog

[One-line summary suitable for a changelog]
