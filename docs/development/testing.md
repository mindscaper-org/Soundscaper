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

## Module and affected checks

The semantic test targets live in `config/module-policy.json`. They are
independent of the execution shards used to spread the complete suite across
CI runners. Existing test paths remain discoverable by the ordinary runner.

Inspect a complete owner target before executing it:

```sh
npm run check:module -- imaging --list
npm run check:module -- imaging --json
```

An explicit module target runs its declared Node tests and browser workflows;
it does not infer additional consumer suites. Use the affected command to test
a change's dependency impact:

```sh
npm run check:affected -- --base=origin/main --list
npm run check:affected -- --base=origin/main --json
```

`--list` and `--json` only inspect the plan. Without either flag, the command
executes it. The comparison defaults to the merge base with `main`; `--base`
selects another branch or revision. Local changes include staged, unstaged and
untracked inputs. Both comparison and current dependency graphs participate so
removed files, renamed files and removed import edges still select consumers.

An affected plan includes the changed modules' complete owner targets and Node
tests reached through their actual imports and test helpers. The graph retains
type-only imports, literal dynamic imports, worker entrypoints and declared
runtime inputs. Browser target metadata declares the exercised modules and
required product origins; a shared module dependency can select that workflow
without pulling in every browser suite owned by a reverse timeline consumer.

Unknown changed paths, unavailable comparison revisions, shared toolchain or
policy inputs, unresolved dependencies in an affected closure, and owners
without independent coverage require the complete gate. Unrelated unresolved
code does not expand an otherwise closed target. Legacy graphs can still force
a full fallback even when the changed module itself has independent coverage.
Read the reasons in the plan; agents must not execute its full fallback.

Focused execution retains repository-wide lint, type checks, architecture and
audits. It runs heavy phases sequentially, requests one Node test process and
one browser worker, and builds only the products required by the selected
browser workflows. Keep development RAM usage within 12 GB. Prepared sites
retain their exact build evidence, source-map authentication and separate
origins. `SCAPE_BROWSER_PRODUCTS=soundscaper`, `framescaper` or `lightscaper`
selects one ordinary browser product; comma-separated IDs select a subset.
Leaving it unset preserves preparation of all three products. Lightscaper
workflows declare the additional product origins needed for editable handoff
and product switching.

PR CI records the affected plan in the existing Build job and passes it to the
existing Node, browser and Coverage jobs. It does not allocate a job per module.
Full main, manual full and release runs retain the complete gates. The Coverage
aggregate verifies the planned results and checks independent module coverage
for a partial plan; legacy owners continue to require the complete coverage
union. See [coverage floors](end-to-end-coverage.md#node-and-chromium-coverage-floors).

## Full gates and CI shards

Desktop build jobs restore installed npm trees using the shared verified-input
action. Cache identities bind the runner image, architecture, Node/npm versions,
lockfile, package patches, and installation policy. A restored tree is checked
before use; Windows admits absolute workspace junctions only to the exact
checkout workspace. Missing or damaged trees fall back to `npm ci`.

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
Node shard uses two test processes. Each browser shard uses one worker and zero
retries, preserving the native Lightscaper qualification requirements. Firefox
and WebKit projects also allow one worker per shard in ordinary local runs,
matching their native audio/video CI limits. Browser shards still run concurrently.
Browser preparation runs the production build once, builds the separate
Framescaper and Lightscaper sites, and authenticates all three product sites
before browser tests start. Four browser shards share owned Soundscaper,
Framescaper and Lightscaper previews, avoiding port collisions. Node coverage is
collected separately for each shard and reported over their fresh union after
all five pass, using the same local coverage policy as `npm run check`.

Before any Node or browser shard starts, `check-all` provisions and verifies the
pinned interchange readers and DAWproject schema validator through
`npm run provision:interchange-conformance`. This needs Python 3.9 or newer and
Python wheel-tag support from `packaging` or pip; set `SOUNDSCAPER_PYTHON` to
select an interpreter. Packages remain under the ignored
`vendor/interchange-conformance/` tree, with verified downloads cached under
`.wrangler/test-download-cache/interchange/`. A preparation failure blocks the
test shards and coverage report while independent static checks can finish;
its diagnostics appear in `test-results/check-all/logs/prepare-interchange.log`.
Direct focused conformance runs still need the provisioning command first.

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
finish. Piped output prints periodic snapshots. Command diagnostics retain their
task prefix, even when they contain expected errors; `FAIL` identifies reported
test failures or failed commands. Full command output is saved under
`test-results/check-all/logs/`; browser diagnostics have separate directories under
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

Complete coverage floors are evaluated over the required union, never per
execution shard; see
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

## Native nightly diagnostics

The distributed `nightly-with-tests` runner complements CI with focused hardware
WebGL2 checks, browser and packaged-app performance measurements, packaged
desktop workflows, and real local-model inference. It bundles only Chromium;
ordinary cross-browser and dual-origin workflows remain CI gates. Run the
package on a native target machine with a working GPU driver. Its graphics
probe fails on software rendering. Performance phases use one worker to avoid
competing measurements. See the [runner instructions](../../Technical_README.md#nightly-test-runner-artifacts)
and [real-model guide](../operations/local-models/nightly-tests.md).
