# Development testing

Use the Node.js and npm versions in the [contribution setup](../../CONTRIBUTING.md).
Keep total RAM usage within 12 GB. Begin behavior changes with a focused failing
test, then run the smallest checks that exercise the affected owner.

## Agent execution and handoff

Agents never run full test suites themselves, including the full Node suite,
the full browser suite, or aggregate gates that invoke them. This includes
`npm test`, `npm run test:coverage`, `npm run check`, `npm run test:browser`,
and `npm run test:browser:built` without a focused selection. Agents may run
focused tests, lint, static checks, and builds.

At implementation handoff, report the checks actually run and give the user a
copyable test command with the absolute path of the worktree containing the
changes. For the canonical non-browser gate:

```sh
cd '/absolute/path/to/the/worktree' && npm run check
```

For interactive changes, include the browser suite as well:

```sh
cd '/absolute/path/to/the/worktree' && npm run check && npm run test:browser
```

Replace the example path with the actual worktree path. Do not report an
unrun suite as passing. The full-suite commands below are for the owner or CI.

## Focused development checks

Run `npm run lint:changed` during development and handoff for added or modified
lintable files. For a specific Node regression, name its test file explicitly:

```sh
node --import tsx --import ./scripts/node-style-asset-loader.mjs --test tests/<file>.test.ts
```

The imports support TypeScript and stylesheet assets used by editor modules.
Plain JavaScript tests without those dependencies can use `node --test` directly.
Use `--test-name-pattern='test name'` before the file to narrow a run further.

| Change | Development check |
| --- | --- |
| Domain, helper, or controller | Focused Node regressions and `npm run typecheck` |
| Vite or React UI | `npm run build` |
| User interaction | Build, then run the affected Playwright spec or named test |
| Patch, WASM, codec, or notice metadata | Matching `audit:*` command |

## Full gates and CI shards

`npm run check` is the canonical non-browser gate. It runs lint, strict type
checks, architecture and file-size guards, audits, documentation checks, the
production build, and Node coverage. `npm run check:static` runs everything in
that gate except the Node suite.

Maintainers can run that gate and the complete ordinary Playwright suite
(Chromium, Firefox and WebKit) together:

```sh
npm run check-all
```

`check-all` schedules up to four checks or test shards at once. It splits lint
using the existing eight lint shards, Node tests using their five named shards,
and the browser suite into four partitions spanning all three engines. Each
Node shard uses two test processes and each browser shard admits up to two
workers. Firefox and WebKit projects allow one worker per shard, matching their
native audio/video CI limits; this project limit also applies to ordinary local
runs. Browser shards still run concurrently.
Browser preparation runs the production build once, builds the separate
Framescaper and Lightscaper sites, and authenticates all three product sites
before browser tests start. Four browser shards share owned Soundscaper,
Framescaper and Lightscaper previews, avoiding port collisions. Node coverage is
collected separately for each shard and reported over their fresh union after
all five pass, using the same local coverage policy as `npm run check`.

The command requires Linux with cgroup v2 memory accounting and a working
systemd user session (`systemd-run --user`). Every check or shard runs in a
verified scope with `MemoryMax=8G` and `MemorySwapMax=0`: the 8 GiB cap includes
its native processes and descendants, including detached children. The shared
preview servers have a separate 8 GiB scope. These are per-scope ceilings, so four
busy shards can together use up to 32 GiB, plus previews and the coordinator.
An unavailable memory controller fails the command before checks start;
there is no uncapped fallback. Other platforms can use the existing individual
commands. An allocation killed by the scope's memory limit fails its check.

The terminal shows a progress bar for completed checks and the currently
running tests. Successful test results stay quiet; test failures print as they
finish, including failed browser attempts that will retry. Piped output prints
periodic snapshots. Command diagnostics retain their task prefix, even when
they contain expected errors; `FAIL` identifies reported test failures or
failed commands. Full command output is saved under
`.wrangler/check-all/logs/`; browser diagnostics have separate directories under
`test-results/check-all/`. Independent checks continue after a failure, while
checks that need a failed prerequisite are marked blocked. Any failed or blocked
check produces a nonzero exit. Ctrl-C terminates all owned scopes and their
descendants. A worktree lock prevents overlapping `check-all` invocations; after
a forced kill, remove `.wrangler/check-all.lock` only once that run has stopped.

Use `npm run check-all -- --list` to inspect the plan without running checks.
Agents must not run `check-all`, just as they must not run the other full-suite
gates; focused regressions and fixture-only runner tests remain allowed.

`npm test` runs JavaScript and TypeScript Node tests through the repository
runner. CI splits that suite because it no longer fits a four-core runner.
A test belongs to `framescaper` or `soundscaper` when it reaches into that
product's own `src/`, `desktop/`, or `native/` tree, including through test
helpers, or carries that product in its filename. Shared and cross-product tests
belong to `common`, which is divided into execution shards `common-1` and
`common-2`. Product shards retain their product names. To select one shard:

```sh
npm test -- --shard=framescaper
```

Coverage floors are evaluated over the required union, never per shard; see
[coverage collection](end-to-end-coverage.md#node-and-chromium-coverage-floors).

## Browser workflows

Browser tests live in `tests/browser/` and use `playwright.config.mjs`.
Playwright runs Chromium headlessly and starts its own loopback preview at
`http://127.0.0.1:4322`; it needs no IDE browser, graphical session, or separate
development server.

The owner runs `npm run test:browser` for the full suite, including the product
builds and preparation. With current prepared builds, the full-suite command is
`npm run test:browser:built`. For focused development, prepare both product sites
first, then select a spec:

```sh
npm run pretest:browser
npx playwright test tests/browser/<file>.spec.js --project=chromium
```

Add `--grep='test name'` to select a workflow within the spec. If port 4322 is
occupied, prefix the command with `PLAYWRIGHT_PORT=4323` or another free port.
If a sandbox blocks loopback binding with `listen EPERM`, request permission to
run the focused browser test outside that sandbox when the environment supports
that permission flow. Otherwise report the limitation and hand off the command.
Inspect failed-run diagnostics under `test-results/`; never edit or commit them.
Chromium coverage preparation and collection are documented in
[end-to-end coverage](end-to-end-coverage.md#capture-evidence).
