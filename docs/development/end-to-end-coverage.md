# End-to-end coverage

Soundscaper has a strict end-to-end coverage gate for the production JavaScript
that ships in its two browser sites and two Electron applications. The native
gate unions evidence from the Chromium browser suite and the packaged
`nightly-with-tests` runner. Every source defaults to native coverage. Exact,
reviewed deterministic sources can instead require separate Node coverage under
`config/coverage-test-layers.json`. Both layers require exactly 100% coverage for
lines, statements, functions, and branches; neither rounds a partial result up.
The existing Node and Chromium cohort floors remain separate and unchanged.

## What the gate measures

The denominator comes from the authenticated production build, not from a
hand-maintained source glob. A source map owns only executable first-party
sources under `src/` or `desktop/` that it actually maps. If an emitted script
has no such mapping, the exact emitted JavaScript is measured instead. Exact
mapped third-party code is excluded; listing an unused first-party source in a
map is not enough to classify a vendor bundle as first-party.

Before evidence is accepted, the build audit inventories every JavaScript and
HTML resource and rejects unrecognized executable-string producers such as
`eval`, executable `Blob` workers, dynamic imports, or inline HTML handlers.
The macro runner is a closed first-party recipe: its fixed,
digest-authenticated module wrapper is measured while the user's macro program
remains data. Any other generated module or changed wrapper fails admission.

First-party WebAssembly is authenticated outside the JavaScript denominator.
Chromium must identify it as `WebAssembly` in `Debugger.scriptParsed`; its exact
canonical network, packaged custom-scheme, or local file URL must resolve to one
inventoried product artifact, and `Debugger.getScriptSource` must return empty
text plus canonical base64 bytes with WebAssembly magic that equal that artifact
byte for byte. Chromium legitimately may emit no precise-V8-coverage range for
such a module. The typed parse event and byte identity are therefore the proof,
and the collector omits authenticated Wasm before writing raw result and source
caches. If Chromium does emit a range, only the same authenticated script ID and
parsed URL can be omitted.

Third-party dynamic code is excluded only through byte-exact recipes derived
from the authenticated build. The admitted Mediabunny `Blob` workers are
reconstructed from their emitted call sites and matching source-map spans. The
FFmpeg core remains a separate rule: it is admitted only at its canonical
production JavaScript and Wasm URLs with the manifest and publication-policy
pins committed at the recorded revision. Its JavaScript source bytes are
checked directly; typed Wasm debugger bytes must have the pinned digest and
WebAssembly magic. A changed URL, query, fragment, source, pin, policy, or
producer fails rather than widening the exclusion.

Raw V8 input is checked structurally against the authenticated JavaScript and
its source map. Required root, explicit-function, and class-initializer spans
come from an independent parse and cannot disappear from the union. Reported
functions must match those source-derived spans, while their block ranges must
use contextual source boundaries and form nonduplicated nested or disjoint
trees. Selected branch-count and outcome-cardinality checks reject collapsed
topology. These checks detect malformed or incomplete capture structure; as
with other local coverage tools, the runtime counts themselves are trusted
capture evidence, not a cryptographic attestation that could distinguish an
edited count from an identical genuine count.

Executable routes created only by a browser test do not contribute coverage.
Those tests opt out of collection, and a recursive static guard follows their
local helpers to reject an unmarked JavaScript response, inline script, event
handler, `srcdoc`, or `javascript:` URL. The packaged M4 and M4B2 synthetic
parity pages remain in the non-instrumented metrics phase and are not members
of packaged coverage. The corresponding production sources remain in the
build-derived denominator.

For Electron, the evidence generator reverse-enumerates JavaScript and HTML in
`app.asar` and executable resources beside it. Its schema-4 product evidence
also preserves exact per-file records and copies for every renderer or runtime
Wasm resource. The packaged runner records the complete executable Resources
identity and that Wasm list before launch, attests custom-scheme and local-file
debugger bytes against those immutable records, and verifies the executable
Resources set again after collection. Assembly rejects added, missing, or
changed files, unknown
profiler URLs, changed source bytes, and unapproved target-runtime scripts.
Test-harness files are packaged separately and are not part of the normal
product inventory; the few generated renderer bridges needed to drive the
packaged application are accepted only by their exact product-bound recipe and
bytes.

The real-model phase launches each product through the diagnostic host with a
fresh private Node coverage directory. It starts precise CDP coverage before
reloading the host, then closes the diagnostic window normally so inference
helpers shut down and Electron checkpoints its main-process profile. Each
session binds its files directly to one product, launch, archive alias, and
canonical executable Resources identity; assembly does not infer ownership from
an operating-system PID that could be reused. A hard-killed child, missing root
profile, stale archive or Resources tree, unmanifested file, or foreign script
invalidates that session. These sessions augment, but never replace, the
ordinary packaged coverage capture required for both products.

## Deterministic source ownership

`config/coverage-test-layers.json` is an exact-file register, with native as its
fixed default. Each Node entry pins the reviewed production source SHA-256,
explicit Node test entrypoints, a deterministic-source reason, and the spec,
title and owning surfaces of a retained native workflow. Prefixes, globs,
generated artifacts, test sources, duplicate entries, unknown fields and paths
outside the repository fail admission. Source and test files must exist inside
the checkout; a symlink cannot move the proof outside it. A source change
requires renewed ownership review and capture.

Eligibility does not establish coverage. The Node layer scores the complete
prepared JavaScript for every selected source at literal 100% in all four
metrics, including unexecuted functions and branches. It binds the configuration
digest, source revision, source bytes, prepared executable bytes and the actual
declared Node test entrypoints. Missing, stale, malformed or incomplete Node
proof fails; native evidence cannot fill its gaps or silently restore a native
fallback. A passing ordinary unit run or a source-map fragment covering only
executed lines is insufficient.

Node qualification currently fails closed for loops (`for`, `for-in`,
`for-of`, `while` and `do`), `switch`, parameter and destructuring defaults, and
logical assignments (`&&=`, `||=` and `??=`). The admission check examines both
the original source and prepared JavaScript. These constructs need independent
checks that execution profiles retain their complete control-flow topology;
a reported 100% alone does not establish that proof. Sources containing them
remain native until those checks are implemented. The admitted forms include
ordinary `if`, conditional expressions, logical and optional expressions, and
the existing catch topology; this is a bounded contract, not a claim that every
JavaScript syntax form has an independently verified denominator.

The full production source and script inventory remains intact. All eight native
runtime surfaces must still contribute authenticated evidence. A Node-owned
source also requires positive native execution of a source-mapped function body
in each declared witness surface, excluding a bundle root and declaration-only
mappings. Only a source with no source-derived explicit or
implicit functions may use a genuine mapped executable statement instead. The
registered native spec and title are reviewed driver selectors, not runtime
attestation; merely naming a test or loading its bundle cannot establish that
witness.

Use Node ownership for deterministic value transformations and explicit port
contracts that can be qualified over their full input contract. Retain native
coverage for layout, focus, keyboard and pointer interaction, browser storage,
workers and CSP, devices, codecs and native adapters. A pure helper under a UI
directory can be reviewed individually; its directory and React owner do not
inherit that decision. Extract mixed pure logic before proposing ownership for
it. Node DOM or storage emulation does not establish native platform parity.

## Node and Chromium coverage floors

The separate Node coverage floors live in `config/coverage-gates.json`;
`.c8rc.json` selects which files c8 instruments. Complete Quality runs check
those floors once over the required union of Node and Chromium shards. Main and
release gates retain that complete union. Never weaken a floor to make an
individual execution shard pass.

Source extracted into the neutral foundation, imaging, media and Scape modules
continues to count toward its inherited `editor` cohort in a complete report.
Moving a source file does not remove it from the denominator or create a lower
coverage budget.

`config/module-policy.json` declares which modules have independently complete
coverage and their inherited cohort. Foundation, imaging, media and Scape can
use a partial PR gate; owners without independent coverage still require the
full union. A partial gate
inventories every production source owned by the selected module and includes
unexecuted files with `c8 --all`. It scores the complete module denominator at
the existing cohort's line, branch and function floors, keeping distinct
inherited cohorts separate. Missing sources, unexpected sources, empty or
malformed profiles and missing budgets fail admission.

Complete CI reports also enforce the independent module floors, so a full
fallback or a main run cannot conceal a module regression inside the wider
editor cohort.

Module gates use fresh evidence from the checked source revision. They do not
borrow coverage from another revision or treat the selected lines as the
module's entire denominator. The affected planner may still require full
coverage when it reaches unresolved legacy dependency paths. Explicit local
module checks remain useful owner targets; they are not a substitute for an
affected-change plan or the full integration gate. See
[module checks](testing.md#module-and-affected-checks) for commands and fallback
behavior.

Focused module execution combines fresh Node and Chromium profiles before
scoring the complete owned source inventory. Its inventory follows the same
include/exclude policy as `.c8rc.json`; test-only tooling and handbook sources
do not become shipped-code coverage cohorts. Independent module floors and the
complete CI union retain their existing thresholds.

After CI has merged the Node and Chromium evidence, run
`npm run coverage:tighten` to raise floors to coverage gained by a scope.
Never tighten against an isolated Node or browser shard. Lowering a floor
requires a deliberate edit with its reason recorded in the register.

## Capture evidence

The owner or CI can build and run the ordinary Chromium suite with coverage:

```sh
SCAPE_BUILD_SOURCE_MAPS=1 npm run pretest:browser
SCAPE_BROWSER_COVERAGE=1 npx playwright test --project=chromium
npm run coverage:compact:browser -- coverage/shards/browser-chromium-local.json
```

Maps are hidden and emitted into a sibling `<output directory>-source-maps/`
directory, so the site bundles retain exactly the same bytes. Collection writes
one raw V8 profile per test under `coverage/v8-browser/`. A spec whose budget
depends on realtime work opts out with `test.use({ browserCoverage: false })`.
Agents use a focused spec selection and the
[test handoff rules](testing.md#agent-execution-and-handoff); they never run the
full suite themselves.

The coverage-enabled npm Node runner also creates a sibling
`<coverage-directory>-qualified/` directory when its selection contains a Node
test bound by the ownership register. For example, the foundation owner can
capture its focused suite with:

```sh
npm run test:shard -- --suite=unit/foundation
```

This preserves the ordinary raw profiles in `coverage/v8-shard/` and writes
qualified evidence in `coverage/v8-shard-qualified/`. `npm run test:coverage`
uses `coverage/v8-all/` and `coverage/v8-all-qualified/` instead. A qualified
capture includes the full prepared modules, pinned source maps, actual raw V8
checkpoints and Inspector observations of the exact runtime implementation.
Ordinary Node profiles alone cannot substitute for this evidence. Quality
uploads `qualified-node-<shard>-<sha>` artifacts alongside its existing shard
coverage artifacts; it adds no execution shards or jobs.

Keep the complete qualified evidence directory and collect the native browser
and packaged evidence at the same full Git revision. Matching source bytes from
a different revision do not make a mixed-revision capture admissible. All eight
native surfaces remain required.

A distributed `nightly-with-tests` application runs focused GPU waveform and
visual-preview tests in Chromium. Ordinary cross-browser and dual-origin
workflow coverage is collected separately in CI or a checkout. The nightly
runner binds both production-shaped Pages sites to the exact, distinct
loopback origins recorded by their manifests, retaining their authenticated
build-evidence denominator. Its graphics phase appends profiles to
`coverage/v8-browser/`; these are supplemental graphics evidence, not a full
browser coverage run. The runner executes packaged desktop coverage after the
non-instrumented browser and desktop performance phases, then real-model tests.
Combine that native evidence with the ordinary Chromium and dual-origin
coverage when evaluating the full gate. Each nightly run directory
preserves:

- `coverage/v8-browser/` for focused GPU graphics profiles;
- `coverage/v8-packaged/` for packaged Electron main, preload, renderer, worker,
  worklet, and service-worker profiles;
- `coverage/v8-local-assistance/` for product-bound real-model Electron main,
  preload, utility-process, and worker-thread sessions;
- `coverage/build-evidence/` for the exact browser and Electron JavaScript,
  source maps, HTML, and schema-4 packaged Resources Wasm records against which
  those profiles were recorded.

The dedicated coverage phase is separate so instrumentation cannot affect the
nightly performance verdict. Keep the entire run directory. Do not copy only
the raw profile files or rebuild the applications before checking them.

One nightly run covers both products on one target. Runs from multiple operating
systems or architectures may be combined when platform-specific paths require
it. Every input must name the same full Git revision and carry
identical executable evidence and normalized source maps, plus identical
authenticated browser evidence. Target-generated
native-runtime manifests intentionally make the enclosing Electron package
archives different; assembly retains each run's runtime, full evidence digest,
and exact archive records while comparing a separate executable-evidence digest.
It still rejects stale sources, different JavaScript, different maps, or mixed
browser builds.

## Assemble and check

Check out the exact revision recorded by the nightly runs, then provide one or
more complete run directories. The first command verifies and combines their
profiles into a portable capture:

```sh
npm run coverage:e2e:assemble -- \
  --output coverage/e2e-capture \
  --node-evidence coverage/v8-shard-qualified \
  /path/to/nightly-run-linux \
  /path/to/nightly-run-windows
```

Repeat `--node-evidence <qualified-root>` for additional qualified directories,
including downloaded Quality artifacts, when bound tests ran in different
existing execution slots. Assembly copies and authenticates every supplied
capture; unqualified raw Node directories are rejected. Missing required Node
proof fails the final gate rather than falling back to native coverage.

Prepare the hash-bound executable inventory and run the strict gate:

```sh
npm run coverage:e2e:prepare -- \
  coverage/e2e-capture/capture-index.json coverage/e2e
npm run coverage:e2e:check -- coverage/e2e coverage/e2e-report
```

Use a fresh prepared artifact directory. Preparation rejects an output directory
that contains qualified Node evidence from an earlier capture.

Assembly fails for missing runtime surfaces, unknown executable URLs, mismatched
source maps, changed repository sources, or unequal executable build evidence.
The capture index keeps the distinct full package provenance for every input
run. Preparation copies the exact generated executables and binds every source,
script, surface, revision, and digest into the inventory. The final command
independently validates each surface, rebases all admitted raw V8 profiles, and
materializes their union in one c8 pass. That lets complementary Chromium and
Electron ranges share the one coverage map c8 derives from their combined execution. The command
exits nonzero if any required surface or executable coverage point is absent.

CDP renderer and preload profiles carry an exact script-source cache which is
checked against the preserved executables. Standard Node V8 profiles contain
URLs and execution ranges rather than source bytes; their main and child-process
entries are instead restricted to digest-authenticated installed paths from the
same preserved package evidence. Only canonical `node:` runtime namespaces are
excluded without file evidence; a path inside an `electron.asar` or
`default_app.asar` file is not treated as an Electron internal. Real-model Node
profiles are read recursively
only from their manifest-bound private session directory, so identical or
reused process IDs across products cannot move coverage between surfaces.

Service workers, dedicated workers, shared workers, and worklets are attached
before their first instruction; a later page-target attachment can miss worker
startup and service-worker install/activate execution. Triggered
precise-coverage updates are banked when Chromium emits them, but detaching a
worker does not itself emit a final update. The coverage-only page hook therefore
pauses `Worker.prototype.terminate()`, checkpoints active workers, and resumes
before the native termination runs.

Cross-document navigation is checkpointed before the old renderer context is
destroyed. The collector pauses the document in `beforeunload`, drains both its
page profiler and its attached dedicated workers, and only then resumes the
reload or navigation. A take triggered by `Runtime.executionContextsCleared` is
too late: Chromium has already discarded the prior document's ranges. Playwright
navigation and close operations also checkpoint first, including a
`page.close({ runBeforeUnload: false })` that deliberately skips the hook.

The generated `coverage/e2e-capture/`, `coverage/e2e/`, and
`coverage/e2e-report/` directories are diagnostics and must not be committed.
