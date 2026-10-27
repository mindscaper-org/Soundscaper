# AGENTS.md

- Use test-driven development principles and keep changes narrowly scoped.
- Follow [contribution setup](CONTRIBUTING.md) and use npm. Preserve
  `package-lock.json`; update it whenever dependency metadata changes.
- Read the relevant [engineering documentation](docs/README.md) and nearest
  nested `AGENTS.md` before changing a subsystem. Source ownership and build
  guardrails belong in [architecture and maintainability](docs/architecture/overview.md).
- Every newly added feature must be reachable through an existing menu or
  submenu. Let the user opt in; do not add always-visible toolbar buttons,
  panels, side rails, badges, or inline controls for new features.
- Preserve the [local-model GPU requirements](docs/architecture/local-assistance.md)
  on every maintained desktop target; never force adapters to CPU or omit GPU builds.
- Never run the full test suite yourself, including full Node or browser suites,
  either directly or through aggregate commands such as `npm run check`.
  Focused tests for the changed behavior are allowed. At the end of every
  implementation, give the user the exact test command to run, anchored to your
  specific worktree's absolute path (for example, `cd '/absolute/worktree' && npm run check`).
  Include the browser-suite command when interactive workflows changed, and
  report which focused checks you actually ran. See the
  [testing guide](docs/development/testing.md) for commands and scope.
- During development and handoff, run `npm run lint:changed` for added and
  modified lintable files. Use appropriate focused tests, static checks, and
  builds from the testing guide. Limit RAM usage to 12 GB.
- Write new controller/domain modules and their tests in strict TypeScript.
  Import the owning module directly; do not add broad barrel dependencies.
  Await, catch, return, or explicitly `void` every promise, and do not pass
  promise callbacks to void-returning APIs.
- Do not grow ratcheted files or weaken architecture, coverage, chunk, or startup
  budgets to make checks pass; extract focused modules and claim reductions.
- Follow the [localization workflow](docs/development/localization.md).
  Never hand-edit `machine` or `audacity` entries or the generated loader index;
  mark hand-written corrections `human`.
- Preserve AGPL and third-party notices, pinned source hashes, and the StaffPad
  reproducibility/audit workflow. Follow the
  [documentation maintenance rules](docs/README.md#maintaining-this-directory)
  for generated policy prose and digest-pinned evidence.
- Follow the [release process](docs/operations/release.md) for version changes;
  commit the release register and generated packaging metadata together.
- Do not commit generated `dist/`, `coverage/`, `playwright-report/`,
  `test-results/`, or `node_modules/` content.
- Use tabs in existing JavaScript/JSX sources.
- Before declaring an implementation task complete, commit your changes in
  atomic commits. Explicitly select your own files when committing.
- Clean up your worktrees, branches, and caches after a merge.
- Write work logs in ignored `private/`, never in `docs/`. Keep docs for durable
  technical information.
