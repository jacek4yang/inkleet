# Consolidation and history retention (2026-10-22)

The repository is moving to one long-lived branch, `main`. Development uses short-lived PR branches, removed after successful merge and verification.

## Frozen inventory

See [branch-heads-2026-10-22.json](branch-heads-2026-10-22.json) for all 97 branch names and commit IDs. The integration snapshot is `9486acd1efea9cfd69d56566fd2ebb44cfc4d51a`; the original main is `9cfe8674f365b098cd54e060ad620c81e10c1f54`. All non-integration heads were rechecked unchanged at 18:47 UTC.

73 historical branch tips are already ancestors of the integration snapshot. 22 divergent historical tips are retained as additional parents of the explicitly labeled history-retention merge commit. This preserves their complete reachable history without retaining 22 permanent branches or introducing archival Release tags.

## What this merge does and does not mean

The current application tree is the consolidated implementation. Old divergent tree contents are NOT blindly overlaid on it. Relevant production changes in compact-breakpoint-gutter, download-proxy-inputs, named-solutions, and lsp-semantic-analysis were independently found in the consolidated source. Older alternative workflows, tests, probes, screenshots, and documentation remain retrievable from the exact historical commit IDs.

A parent relationship here records intentional resolution in favor of the consolidated implementation and retention of historical material. It is not a claim that every historical file is present in the current tree or that every historical test ran on the final application. Historical closed PRs were superseded, not individually merged through their PR endpoints.

The accompanying native test change only navigates through the actual Settings search to `editor.formatOnSave` before clicking the checkbox. Native click bounds/hit testing, checkbox-state, Save, and on-disk persistence assertions remain intact. No native test is waived.

## Cleanup prerequisites

1. The main ruleset requires a PR, up-to-date checks, resolved review threads, CI Frontend Regression, Native Linux Full Validation, and Packaging Required; force pushes and deletion are blocked, with no bypass actors.
2. Merge the consolidation PR using a merge commit, not squash/rebase, to preserve all ancestry.
3. Verify main and post-merge checks. For every deletion, re-read the current branch tip and prove it is reachable from main. Stop if a branch moved or has independent work.
4. Delete only non-main branch refs. This does not delete commits, tags, releases, user data, or application settings.

## Restoring historical work

Use the recorded exact SHA to inspect an old tree or create a new short-lived branch. The history-retention merge must remain an ancestor of main. A deleted branch name is not required to access its committed files.
