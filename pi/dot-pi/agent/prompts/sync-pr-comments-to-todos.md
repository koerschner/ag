---
name: sync-pr-comments-to-todos
description: Sync PR review comments with todos, creating missing todos and resolving completed threads
argument-hint: "[PR number/url/branch or optional matching guidance]"
---

# Sync PR Comments to Todos

Use GitHub PR review comments and the local `.pi/todos` state to keep review work tracked. Create todos for unresolved PR comments that are not already represented, and resolve PR review threads whose matching todos are complete.

Input from the user:

$ARGUMENTS

## Rules

- The PR comments are the source of truth for missing review-work todos.
- The todo status is the source of truth for whether a PR thread should be resolved.
- Create a todo for every unresolved PR review thread that does not clearly match an existing todo.
- Resolve a PR thread only when you can confidently match it to a todo and that todo is complete/closed/done.
- Do not resolve comments just because code changed.
- Do not create duplicate todos for comments that already have a clear matching todo.
- Do not resolve unmatched, ambiguous, open, blocked, or in-progress todos.
- Do not delete todos.
- If a PR comment is not a resolvable review thread, do not pretend it was resolved. Report it separately.
- Never create a git commit.

## Process

1. Identify the target PR.
   - If `$ARGUMENTS` includes a PR number or URL, use it.
   - Otherwise run `gh pr view --json number,url,title,headRefName,state 2>/dev/null` for the current branch.
   - If no current-branch PR exists, run `gh pr list --limit 20 --json number,title,headRefName,author,url` and ask the user which PR to use.

2. Gather local todos.
   - Use the `todo` tool with `action: "list-all"`.
   - Use `todo get` for likely matching todos to read full bodies.
   - Treat statuses such as `closed`, `complete`, `completed`, `done`, or equivalent completed wording as complete. Treat all other statuses as unresolved unless the todo body clearly says it is complete.

3. Gather PR review threads and comments.
   - Prefer GraphQL so you can see thread IDs and `isResolved`:

     ```bash
     gh api graphql -f owner="$(gh repo view --json owner -q .owner.login)" \
       -f name="$(gh repo view --json name -q .name)" \
       -F number=<PR_NUMBER> \
       -f query='query($owner:String!, $name:String!, $number:Int!) {
         repository(owner:$owner, name:$name) {
           pullRequest(number:$number) {
             number
             url
             reviewThreads(first:100) {
               nodes {
                 id
                 isResolved
                 path
                 line
                 originalLine
                 comments(first:20) {
                   nodes {
                     id
                     author { login }
                     body
                     url
                     createdAt
                   }
                 }
               }
             }
           }
         }
       }'
     ```

   - Also inspect non-thread PR comments if useful with `gh pr view <PR_NUMBER> --comments --json comments,reviews`, but remember these may not be resolvable threads.
   - If there are more than 100 review threads, page through the remaining threads before deciding.

4. Match PR threads to todos.
   - Compare the comment body, file path, line, author, and requested change against todo titles and bodies.
   - Prefer exact references such as comment URLs, thread/comment IDs, file paths, quoted comment text, or PR comment summaries in todo bodies.
   - If multiple todos could match or the todo is too vague, treat the match as ambiguous.

5. Create missing todos.
   - For each unresolved review thread with no clear matching todo, create one todo.
   - Use a concise title like `Address PR #<number> comment: <file path or short summary>`.
   - Include enough detail in the todo body to make future matching exact:
     - PR number and PR URL
     - review thread ID
     - comment IDs and comment URLs
     - file path and line/original line
     - author
     - full quoted comment body or a faithful summary if very long
   - Tag created todos with `pr-comment` and `pr-<number>`.
   - Leave new todos in an open/actionable status.
   - Do not create todos for already-resolved threads unless the user explicitly asks.

6. Resolve completed threads.
   - For each unresolved review thread that clearly matches a complete todo, resolve it with:

     ```bash
     gh api graphql -f threadId="<THREAD_ID>" \
       -f query='mutation($threadId:ID!) { resolveReviewThread(input:{threadId:$threadId}) { thread { id isResolved } } }'
     ```

   - Re-fetch the PR review threads afterward and verify each intended thread now has `isResolved: true`.

7. Reconcile todos lightly.
   - If a completed todo was matched to a thread that is now verified resolved, append a short note to the todo with the PR number and thread/comment URL.
   - If a todo says it is complete but the thread could not be resolved because of permissions/API errors, append that fact instead.
   - For newly-created todos, do not immediately mark them complete.
   - Do not change the status of unrelated todos.

8. Report back.
   - Include the PR URL.
   - List todos created, with todo IDs/titles and comment URLs.
   - List threads resolved, with matched todo IDs/titles and comment URLs.
   - List threads intentionally left unresolved, grouped by reason: todo not complete, ambiguous match, already resolved, or non-resolvable PR comment.
   - Mention any API/page-limit/permission issues.
