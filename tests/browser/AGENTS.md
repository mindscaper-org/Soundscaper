# Browser test guidance

- Test user-visible workflows through roles and stable accessible names. Avoid
  implementation selectors and fixed sleeps.
- Never commit `test.only`; CI rejects focused tests. Failed-run traces and
  screenshots belong in generated `test-results/` or `playwright-report/`.
- Never run the full browser suite yourself. Prepare the product sites with
  `npm run pretest:browser`, then use a focused `npx playwright test` invocation.
  At handoff, give the user the full-suite command with your worktree's absolute
  path, following the [testing guide](../../docs/development/testing.md).
- Keep new scenarios in the matching focused editor spec. Reuse
  `audio-editor-test-fixtures.js` and
  `audio-editor-test-helpers.js`; keep feature-specific setup beside its spec
  rather than rebuilding a catch-all file.
