# Motionscaper implementation order

Status: **In progress** on `feat/motionscaper`. This document
owns the agreed Motionscaper scope, implementation order, dependencies and
completion gates. It describes the release target; all packages below remain
required for the first public release.

Motionscaper is a new local-first motion-graphics and compositing program for
the browser and Electron. It shares the editor platform with Soundscaper and
Framescaper, owns its project format, and supports saved-revision composition
links into Framescaper. After Effects exchange uses scripts in an installed
copy of After Effects and a documented editable subset.

## Agreed release boundaries

- Include composition/layer editing, graphical animation editing, typography,
  vector shapes, parenting, precompositions, masks/mattes, effects, time
  remapping, audio playback, and audio-driven animation.
- Include bounded JavaScript-style expressions, 2.5D layers, cameras, lights,
  shadows, depth of field, and motion blur.
- Include point/planar tracking, stabilization, corner pinning, chroma keying,
  and animated masks with manual corrections.
- Include linear-light SDR compositing, transparent delivery, browser and
  desktop packaging, offline linked compositions, and supported Adobe exchange.
- Defer imported 3D meshes, extruded geometry, automated subject rotoscoping,
  3D camera solving, content-aware removal, HDR/wide-gamut mastering, and
  unrestricted JavaScript.
- Native Adobe plug-in hosting and direct general-purpose `.aep`/`.aepx`
  parsing are separate feasibility work. The initial bridge can render
  unsupported AE effects and plug-ins in installed After Effects.

## How to execute the order

Start with the earliest incomplete package whose prerequisites are complete.
Within each package, add meaningful failing tests before implementation and
finish a maintained workflow before marking the package complete. Commit
changes in bounded, atomic units naming the package and outcome; select only
the files owned by that change. Keep all package statuses **Planned** until
implementation starts, then use **In progress** or **Implemented** only when
the corresponding behavior and automated gate justify it.

New domain/controller modules and their tests use strict TypeScript.
Product-specific application ownership belongs in `src/motionscaper/`; reusable
media, effects, rendering, storage, workers, and WASM integration belong in
`src/common/editor/`; UI belongs in `src/common/editor/ui/`. Extract reusable
Framescaper modules through narrow adapters rather than copying its controller
or relabeling its project runtime.

Every new feature has a menu entry. Reuse existing menu shells and submenus;
**File → New Composition** and **View → Motion Workspace** open the authoring
workspace. Graph, expression, tracking, and render-queue surfaces are opt-in.
Add no new always-visible toolbar controls, panels, rails, badges, or inline
controls. Keyboard shortcuts may supplement the menu entry.

| Order | Package | Prerequisites | Outcome |
| --- | --- | --- | --- |
| M01 | Product registration and platform seams | None | Isolated browser and desktop application shells. |
| M02 | Project, asset, and migration contracts | M01 | Durable Motionscaper projects and the Framescaper successor schema. |
| M03 | Composition evaluation | M02 | One deterministic evaluator for all consumers. |
| M04 | Typography, vectors, and 2D rasterization | M03 | Readable, portable composition frames. |
| M05 | Preview, delivery, and render queue | M04 | A complete composition-to-export workflow. |
| M06 | Layer and animation authoring | M05 | Usable motion-design editing and graphical keyframe tools. |
| M07 | Compositing and motion-design VFX | M06 | Masks, effects, tracking, and manually corrected roto workflows. |
| M08 | Expressions and procedural animation | M06 | Bounded, deterministic property expressions. |
| M09 | 2.5D cameras, lights, and temporal rendering | M07, M08 | Complete 2.5D compositing with blur and depth of field. |
| M10 | Linked Framescaper compositions | M02, M05, M09 | Saved revisions update portable, offline-renderable links. |
| M11 | After Effects interchange bridge | M05, M06, M07, M08, M09 | Qualified editable exchange with explicit baking reports. |
| M12 | Distribution and release qualification | M01–M11 | Both platforms pass the complete first-release gates. |

The table is the default execution order. Its prerequisites identify the
minimum dependency closure; a later package does not make an unfinished earlier
package complete.

### Implementation status

As of 2026-10-22, M01–M12 remain **In progress**; **no milestone is accepted**.
Engineering completion is estimated at **about 90%**; this estimate does not
accept a package or public release.

The latest completed full Node checkpoint remains `bc586f975`, a two-file,
six-line fixture correction after application checkpoint `0282106d9`.
Subsequent focused application corrections are recorded below; the complete
gates must run again on the final source. Completed results retain their actual
source revisions and tested patch bytes.

The fresh complete Node gate passes on `bc586f975`: the desktop-runtime fixture
and all five unfiltered maintained shards close successfully, with **28,168
passes, 22 reviewed declared skips and zero failures** across 28,190 tests.
The corrected total includes two isolated passed batches omitted from the first
summary. Foreign-target and optional/manual fixture skips retain their explicit
scope; they are not additional executed host qualification. The failed `0282106d9`
Node cohort and its raw coverage remain unadmitted.

The complete static gate passes on `0282106d9`, including full lint, strict
types, architecture, audits, documentation and the production build. Fresh Linux
x64 staging, both unpacked packages and resource verification pass on that
application revision. The qualified Linux native build, five Motion CTests and
independent reference retain compilation revision `f0191caeb`. Maintained native
source-equivalence checks permit reuse; no receipt is retagged.

All four original Linux maximum workloads pass on `0282106d9`: maximum quality,
64 planes, 32 lights and 32,768 frames. Index timestamps, selected picture/alpha
checks and exact 52,428,800-sample stereo 48 kHz PCM pass. Retained PSS growth is
63,619,584 bytes against the unchanged 67,108,864-byte limit. Resource/process
closure, output preservation, sandbox-custody return and private audio shutdown
pass. The failed `f03463912` index result remains failed; this pass establishes
neither a leak cause nor broader hardware/platform acceptance.

Windows D6 passes the maintained restore, stage, unsigned unpacked-package and
`--require-native-prores` smoke phases on application `0282106d9`, with owned
process closure. Its native binary retains the qualified `4c614e0b46` compilation
revision and its original receipt. This local Windows x64 software-GPU scope
covers the original two-frame ProRes case with stereo 48 kHz PCM; it does not
qualify hardware GPUs, installers, signing, updating or other targets.

The fresh hidden-source-map browser build passes on `bc586f975`. Discovery finds
**7,614 ordinary identities**, 2,538 per engine. The unfiltered four-worker
Chromium/Firefox/WebKit attempt used zero retries and the default application
heap, but was **interrupted and failed**. Its saved list log contains **1,819
passes, 32 skips and eight failures**; no complete report was produced, so these
are provisional observed outcomes rather than an accounted full-suite result.

The resource guard disappeared while the original finite test owner remained
active. The authenticated owned Playwright child was canceled, leaving that
owner to clean up descendants and finish its postconditions. The cause of the
guard loss is unknown; no OOM or leak cause is established. Inputs remained
unchanged and output writers closed. The independent 2026-10-22 audit finds all
4,311 recorded process births absent. All 889 raw coverage files remain opaque
and unadmitted. The closure receipt is
`current-bc586f975-browser-interruption-closure-20261022.json`, SHA-256
`8c9067b6bedd3e76ec42917e37d88ea2c70503f7f8479b87efca78ab0e516d43`,
under the retained Motionscaper recovery evidence directory.

Focused work now addresses the saved failures: damaged-autosave recovery,
mono paste, recovered recording audio, original-file overwrite readiness,
desktop recording channel selection, nonmodal dialog focus and pencil
amplitude. Saved evidence and focused regressions retain their individual
scope; none turns the interrupted run into a pass.

`16f5e83a8` publishes coherent recording-channel and route state before awaiting
required persistence; its regression fails before the correction and all 37
focused checks pass afterward. `aac0a6714` preserves focus deliberately moved
outside a nonmodal dialog before its initial animation frame; its regression
also fails before the correction and all 33 focused checks pass afterward.
Scoped strict types, changed-file lint and size checks pass. `316c8af24` adds the
existing public import-ready precondition to the Dialogue overwrite test.
On `b9199d352`, both desktop-recording cases and the nonmodal dialog case pass
in WebKit; the Dialogue overwrite case passes in Chromium. All four retain
their original assertions and case timeouts, with zero retries, skips or
failures. Source/site checks pass and all 84 recorded command process births
are absent. This is focused verification, not complete browser acceptance.

`db893d23b` also preserves an application-menu item selected before its initial
keyboard-focus frame. Two regressions fail before the one-line correction;
all 46 focused menu checks pass afterward. A broad test TypeScript check hit
Node's default heap limit before producing diagnostics and remains failed.
Smaller strict checks for the changed menu test and diagnostic helper pass
without a heap override. Changed-file lint and size checks pass.

The recovery, recording and menu diagnostics (`0b79183c2`, `834af7ade`,
`e65e33636`) preserve original actions, assertions and timers. Nine controlled
blank-document checks pass for menu-event passivity, attribution, bounds,
disposal and failure attachment. The first Node-based diagnostic runner remains
failed: its serialized callback contained undefined compiler name helpers.
The successor uses the unchanged helper through Playwright's normal transform;
this establishes diagnostic plumbing, not an application failure cause.
On `0ee60f956`, mono-paste confirmation, recovered recording audio and pencil
editing pass their original Chromium assertions with zero retries. The remaining
WebKit damaged-autosave case still fails its original 30-second opened-status
assertion. Its worker diagnostic records one import-planning request receiving
both `PROJECT_NOT_OPEN` and a result; the emitted lazy dependency graph imports
the executable worker entry. Both focused commands pass source/site/audio
postconditions and process closure; all 53 recorded process births are absent.
The failed WebKit result remains failed.

`d9b4a8676` isolates that worker's already-initial library graph from its
registration code, preserving existing vendor owners, lazy recovery/import
modules and chunk ceilings. A real Vite emission regression reproduces the
original registration backedge; the correction passes all 37 focused chunk
checks. The emitted registration entry has one source module and no shared
exports, and all five recovery/import consumers remain lazy. Scoped strict
types, changed-file lint and size checks pass. Earlier failed candidate layouts
and the corrected regression's failing baseline remain preserved.

The fresh three-product hidden-source-map build passes on `18dd1724b`. All four
original WebKit recovery cases pass on that revision with zero retries, skips
or failures; source/site/audio postconditions and all 24 recorded process-birth
closures pass. Linux native source equivalence, both fresh desktop stages,
unsigned unpacked packages and exact resource verification also pass on
`18dd1724b`. These retain their original native compilation receipts and do not
qualify installers, signing, hardware GPUs or additional hosts. All eight saved
ordinary-browser failures now have focused passes on their respective correction
revisions; they are not one complete final-source browser cohort.

`d0fef8db3` changes only the chunk regression's import to its owning module; the
real emission regression, scoped strict types and changed-file lint pass.
Its full static attempt was deliberately canceled before completion when the
scope review found that desktop startup forced English and offered no language
preference. The original terminal code 125 and owned cleanup are retained;
all 40 recorded process births are absent. This is an incomplete gate, with no
OOM or leak cause claimed. The new source requires a fresh complete static run.

`a4a233e64` adds the missing desktop preference through **View → Language**.
Startup uses the persisted or supported system locale; a private, closed IPC
setter persists the selected committed catalog before changing copy, `lang` and
`dir` in place. Dirty project state, Undo/Redo and native file binding retain
their existing owners. Future link connections use the accepted locale without
replacing an active connection. Native chooser/error copy follows the preference;
Windows/Linux use the existing localized document-menu convention and macOS
retains OS menu roles. All 43 focused checks, scoped strict types, changed-file
lint and size checks pass; the final App test also passes after a quote-only
lint correction. All 87 recorded process births across the retained attempts are
absent. The generated security narrative and runtime evidence pins are refreshed.
The fresh locale-source build, two-case Chromium workflow and complete gates
remain pending; mocked browser IPC does not qualify actual Electron persistence
or native-menu behavior.

Separate linked, dual-origin and handbook suites also remain pending. The latest
historical failed browser
results retain their failures and do not contribute accepted coverage.

Complete browser acceptance, the fresh Node/Chromium coverage union and its
floors/ratchets, remaining target, installation, signing and update qualification,
and real installed After Effects export/re-import, reference comparison and
host-version qualification remain open. No installed AE environment is
available; M11 and M12 therefore remain incomplete. Publication remains a
separate owner action. No manual **Update AI assets** run is required: the
assistance-runtime closure is unchanged.

#### Historical validation evidence

M01–M12 are **In progress**; named implementations do not close release gates.
As of 2026-10-18, the integration includes the preview progress/cancellation
repair, lazy-chunk ownership correction and CI target-selection corrections.
The complete Node run on `aeec86704665` passed all 1,250 Motion cases, but
failed three shared checks. Focused regressions pass for the subsequent chunk,
Windows tooling and nightly-site corrections; a fresh complete gate is required.

The ordinary browser gate on that frozen source closed failed: 7,119 passes,
307 declared skips and 113 failures, including 19 Motion failures across
Chromium and Firefox. Inputs and sites stayed unchanged, and the recorded
processes retired. The original-file
overwrite readiness correction passes its six focused scenarios across three
engines. The other failures remain
unexplained; passive failure diagnostics preserve their original interactions,
assertions and limits. Focused passes do not replace complete acceptance.

On source `6ab2c71d4`, the packaged Linux x64 five-workflow aggregate and original
300/1,200-frame duration workload passed their independent picture, alpha, exact
PCM, timestamp, memory, preservation and closure checks. The original maximum
quality, 64-plane and 32-light workloads also passed. The 32,768-frame workload
failed its original retained PSS-growth limit before independent output
qualification; its passed physical audit does not qualify the export. These
results do not qualify other platforms.

The complete static gate and independent input/process audit passed on
`feabe1b3c`. The export audio cache correction (`6463b7e69`) passes its red/green
production-path regression,
46 focused Motion cases, strict test and Motion production types, changed-file
lint and the Motion browser build. Full lint passed on the final file bodies.
It preserves the global cache budget and preview LRU behavior. Its unchanged
maximum-index workload remains required. A new private-project package attempt
failed dependency lookup; its physical audit passed, and the next attempt uses
the normal production packaging route.

The first-paint readiness repair (`286fe818`) also passes 43 focused preview
cases, strict test types, changed-file lint, the Motion build and the existing
Chromium preview workflow. It waits for a painted frame before enabling preview
controls or reporting ready; historical timeout causes remain unproven.
The Canvas readiness repair (`92a5abdd`) binds new edits to the current painted
base frame and cancels gestures when their project or asset store changes.
All 28 focused controls and both existing Canvas Chromium workflows pass,
along with strict focused and production types, lint and the Motion build.
The audio repairs (`26de1c9b`, `1d586e7b`) release cancelled resume waits and
start video before PCM scheduling can advance its shared clock. All 24 focused
controls and both existing Chromium preview/audio workflows pass. The raster
runtime repair (`df8fffea7`) cancels an individual consumer promptly while
preserving shared initialization and retries; all 30 focused controls pass.
All 49 selected readiness, audio and raster controls pass together on the
integrated source. The ordinary Motion browser component on `7b804853d` now
passes all 444 discovered identities: 437 passes and seven declared skips,
with no failures or retries. Its independent input/site/process audit passes.
The separate linked-editor component on the same source passes all 13 maintained
Chromium cases, with no skips, failures or retries; its independent preservation
and physical closure checks pass. This is the current Chromium-only configuration,
not a three-engine linked result. The all-product and coverage gates remain open.

The Windows x64 builds exposed assembler discovery, libvpx compiler selection,
source-path persistence and generator-script launching defects. The NASM,
MSVC project-mode, native-path and shell corrections pass their focused controls.
The shell correction also passes a bounded generator, recursive Make and install
control. The subsequent full build fails launching a much longer project
generator command. Verified local source staging passes its focused regressions.
The real long-generator control runs but fails its semantic check: its project
contains 157 of 245 required file references. The subsequent nested-source
correction (`a2623b2d`) passes all 22 focused Windows controls. Its actual
generator check retains the upstream command grouping and produces all 245
references, with the required target, static CRT and unique object names.
The separate full-command-line failure control and independent input/process
audits also pass. The complete native build remains
unqualified. No Windows
host or package is qualified.
The separate FFmpeg path correction (`9f24c039`) stages the same authenticated
source under the build directory, retains native install paths and binds the
authenticated shell for Windows Make. All 29 focused Windows controls pass;
actual compilation and the complete native result verifier remain required.
The subsequent Windows attempt compiles and installs all five codec libraries,
then reaches its inherited deadline after 406 seconds. The owner fails during
timeout cleanup; the builder's numerical exit remains unknown. Independent
preservation and process closure pass. FFmpeg, the host and final verification
remain unqualified; a separate fresh attempt retains the full original
180-minute execution window.
That fresh attempt exits numerically with status one during FFmpeg configure,
before its deadline. Its link log requests `x265.lib`, while the MSVC install
contains `x265-static.lib`. The corrected independent audit verifies the actual
attempt's work tree and process closure; the earlier post used the wrong work
root and remains unaccepted. The Windows-only library normalization
(`e6d808362`) passes all 35 focused Windows controls and 31 Linux controls with
four declared Windows-only skips. The existing Framescaper phase-array expectation
is corrected, with its execution deferred to the final full suite. A fresh native
build, result verification and packaging remain required on the changed manifests.

The next Windows attempt confirms that the library alias works, then fails on
three Registry API symbols omitted from upstream x265 package metadata. Its
failed result and independent input/process audit are preserved. The correction
(`5df0bd496`, integrated in `8530d6c08`) installs a pinned, relocatable Windows
x265 4.2 package-metadata adapter with the required private `advapi32`
dependency. It preserves the alias, raw source, CRT and POSIX recipes. Four
regressions fail before the change; all 41 focused Motion cases pass on Windows,
with strict types, changed-file lint and source audits. Fresh Linux controls,
native builds and packaging remain required.

On `cb163a0ce`, the fresh Linux native build, maintained result verifier,
reference compilation and all five native checks pass, including the independent
input/generated-output/process audit. Its new receipt retains the actual
compilation revision; packaging and installed workloads remain required.
The complete static gate also passes on that source in 703.6 seconds, with
52,070 unchanged inputs, no startup-budget changes and a largest JavaScript
chunk of 488,189 bytes. Earlier failed executions retain their original outcomes.

The complete static gate also passes on `3b2ae0f32` in 693.8 seconds, with the
same 52,070-input closure and 488,189-byte largest chunk. Its three browser sites
and source maps are built and preserved; a complete browser execution remains
required. Five historical original `/tmp` workload directories are unavailable.
All 590 cached copies match their recorded bytes and metadata; this does not
restore or qualify the missing originals. A new input baseline explicitly
records that loss and does not qualify native compilation.

A WSL memory investigation confirms one prior Node OOM kill at about 44 GiB
resident memory with exhausted swap. Its owning command is unknown; a test leak
is not established. WSL restarted, and no surviving test workers were found.
The Linux polling guard passes six synthetic controls; subsequent large runs
require per-run memory recording, a 24 GiB aggregate PSS plus swap abort limit,
an 8 GiB available-memory floor and one resource-intensive workload at a time.
Polling can overshoot and does not provide a kernel-enforced hard limit.

The harness repair on `27c5764f5` addresses unbounded process identity history
and shutdown paths that could wait indefinitely. It caps history, serializes bounded
process sampling, retains terminal cleanup identities and bounds failed
shutdown/CDP cleanup without changing workload limits or the original ten-second
escalation. Connection failures retain transport ownership; late callbacks cannot
resume shutdown signals or erase an earlier failed close. All 60 focused fake
controls, scoped TypeScript and changed-file lint pass. This does not establish
the cause of the earlier OOM or qualify a new large workload. Existing completed results keep
their original source identities.

The Windows FFmpeg dependency-scanner correction (`3883b077e`) follows a tiny
reproduction of the malformed inline awk filter. A pinned file-backed filter
passes the four dependency-output checks; the maintained Linux selection passes
36 cases with five Windows-only skips, plus focused types, changed-file lint,
source-pin and size checks. The maintained Windows transport test subsequently
passed six cases with one expected skip, including both make phases and all four
filters. Its strict owner still failed on a retained pre-workload console process;
exact-handle cleanup and independent recorded-process absence passed. Complete
Windows native-build acceptance remains open. A separate supervisor repair seals
exact startup process identities before launching the workload, requires later
children to close, and explicitly retires sealed startup processes within the
original deadline. All 21 focused controls and a tiny native integration pass;
the worker exits with code zero and all recorded processes are absent afterward.
The earlier failed owners remain failed. This separate build failure does not
explain the WSL OOM.

The prepared Windows qualification driver uses the original retained native
handle and exact FILETIME identity, replacing numeric tree termination and
unbounded waits with waits bounded by the original deadline. The outer owner removes two
redundant unbounded waits. All 19 same-function fake controls pass in 705 ms;
both fixture identities are independently absent. No memory peak was logged,
and these controls do not qualify a complete native build.

Coverage assembly (`847c07eac`) writes normalized profiles incrementally across
runs, preserving source-map placement and rejecting changed bytes between passes.
The original implementation fails the new early-write regression; all five
focused cases, changed-file lint, strict types and size checks pass after repair.
All 38 files in a frozen two-run synthetic capture also match the original bytes.
Individual profiles and later coverage unions still require memory monitoring;
the earlier OOM's owning command remains unknown.

Coverage materialization (`80d614fe3`) also stops retaining every parsed profile
across surfaces. It stages rebased profiles immediately, validates original
observations one script group at a time, and checks staged bytes and membership
before publication. All 11 focused Motion regressions, strict types, changed-file
lint and size checks pass. The largest profile or script group, final coverage
union and c8 process still determine memory use.

Nightly test-child cleanup (`27f1f6118`) retains the original error and waits for
the child and log stream to close. An ignored TERM escalates through the original
child handle after 250 milliseconds. All ten focused Motion fake-process tests,
strict types, changed-file lint and size checks pass. Descendants that escape
the child or retain its pipes still require the outer run supervisor.

The fresh Linux native attempt on `83f68420c` stopped when the monitor could not
read an owned compiler's memory and its retained pidfd did not signal termination
within ten milliseconds. Sampled memory stayed below 900 MiB; no resource limit
was crossed. Compilation, verification and reference acceptance remain open;
the failed attempt and its partial outputs are preserved.

The G2 guardian now allows a 250 ms positive-exit wait on the retained pidfd
after unreadable accounting. A real child delayed by 75 ms reproduces refusal
with the original 10 ms wait; all 21 revised controls pass. Exact identity,
refusal of live or unknown unreadable memory, thresholds and original deadlines
remain unchanged. This qualifies observation policy only; the failed native
attempt remains failed. No **Update AI assets** run was performed.

A fresh Linux x64 native build on `ae0da5384` passes its five native tests,
maintained verifier, reference build and independent preservation/process audit.
Peak owned PSS plus swap was 907,241 KiB (about 886 MiB), with no swap use or
resource abort. All 1,865 recorded process identities were absent. This qualifies
the native build and reference artifacts; installed-app and complete Node/browser
acceptance remain open. It does not establish the original Node OOM cause.

Fresh combined gates, accepted coverage, installed AE, other hardware/targets,
signing, installation, update and publication remain open. No installed AE test
environment is available. Source-specific evidence and remaining work are in
[final validation status](motionscaper-final-integration-validation.md).

#### Earlier gate summaries

The latest application repairs (`fc38539a6`) include shared playback-start
preparation, product handbook navigation, stable source identity in peak probes
and native whole-minute timed-recording input normalization. Focused regressions
pass, including 57 playback controls and nine browser cases across three engines.
Application source `52ae9c43c` subsequently passed the complete static gate and
all five Node partitions: 27,459 passes, 17 declared skips and zero failures,
including all 1,224 Motion cases. Its complete browser run has recorded failures;
browser qualification remains open.

Later test and harness corrections through `f7bde573c` cover spectral input
actionability, Contrast replacement, native seek counting, EQ pixel sampling,
terminal Linux process observations, translation-draft readiness and tempo input.
The process correction passes 39 focused Motion controls; draft readiness and
tempo each pass four WebKit checks. The EQ pixel control passes all three
engines, while two Firefox tone cases failed their preceding signal check.
That signal investigation and fresh complete gates on the combined source remain
required. These focused results do not close milestones or establish the
exclusive causes of earlier failures.

Application source `70a02ba9e` passed the complete static gate and all five Node
partitions: 27,451 passes, 17 declared skips and zero failures, including all
1,224 Motion cases. Its fixed Linux x64 software profile passed all five
installed workflows, the original 300/1,200-frame native duration and four
maintained maximum profiles. One controlled Chromium 300/1,200-frame run also
passed; lossy Opus is not exact PCM, and OPFS does not qualify the OS picker.
Its complete browser gate failed: 7,331 passes, 287 declared skips and eight
failures across ordinary, linked and dual-origin suites. Linked39 and dual9
passed separately. The three UI failures did not recur in bounded one-worker
and four-worker diagnostics; their historical cause remains unresolved.

The handbook repair passes Motion58 and Frame87 page/navigation checks. The
complete Motion Pages build passed local app/docs/staging/asset checks, then
failed its live predecessor preflight because no deployment answered the
canonical origin. No deployment or bypass was performed. Accepted coverage,
installed AE, other hardware/targets, signing, installation, update and
publication remain open. Source-specific evidence and remaining work are in
[final validation status](motionscaper-final-integration-validation.md).

### Earlier source-attributed implementation and validation

The following notes preserve their original dates, sources and outcomes,
including the pending prerequisites at each boundary. Later passes do not
promote earlier failures or establish their causes.

The final scope audit found two locale seams and missing generated Motion copy.
The editor admission fix (`2e10bc63e`) now covers all ten Motion copy owners and
the shared effect labels it consumes. Its actual loader/resolver regression
failed before the fix; all 18 focused controls, strict types, lint and size
checks pass. The bridge locale fix (`3ad4bda4e`) also admits complete catalog
tags, retains them through both bridge windows and resolves late-arriving copy
without reconnecting. Its 13 combined catalog/locale/lifetime controls pass;
the real French cross-origin case awaits the fresh browser run.
Integration `f6eb44aa9` contains all 26 generated languages, adding 19,032 current
Motion/bridge strings and 52 Motion handbook pages through the maintained
writers and validators. Each language adds 732 keys while preserving its 4,019
prior entries, the other catalogs and loader index. The final handoff contains
exactly 78 translation files; root independently matched their bytes and all
104,494 prior entries. Whole-language handbook completeness is not claimed.
The new
incompatible-morph UI case (`ce13106ed`) has static checks only; browser runtime
proof is pending. Codec tests (`4fa4b3450`) now retain their actual encoded or
refused branch, parsed facts and output bytes; no new encoding result is claimed.
These changes require fresh applicable final gates; the earlier results below
retain their exact source attribution.
The full gates on `361418fee` closed failed: Node reported 27,406 passes,
45 failures and 17 skips, with all 1,224 Motion cases passing. Forty-four
failures reached missing reference-reader or dependency-path prerequisites;
one caught the expanded Hindi catalog's chunk size. The static gate also
refused seven oversized locale chunks. Repair `802026569` separates complete
catalogs into lazy core/Motion owners. Its production-bundler test round-trips
all 59 catalogs, and the normal application build passes with a largest chunk
of 486,512 bytes and its startup graph within the unchanged limits. The test
environment repair and fresh full gates remain required; neither failed gate
is promoted by these focused results.
Substantial implementations and focused browser/native workflows pass. The
complete static gate on `c6033a71a` passed full lint, types, architecture,
audits, documentation and production build, with the 12 GiB heap confined to
that static command. Source/package, owned-copy, process and output guards
passed; startup tightening changed no budget. The earlier `db4e586d0` static
pass remains separately attributed. The earlier `2f1ffce7f` package-directory
symlink refusal remains failed and source-attributed.
All five exhaustive Node partitions on `c6033a71a` passed: 27,442 passed,
zero failed or cancelled and 14 declared skips out of 27,456 tests. All 1,212
Motion cases passed. Input, sampled-process and stable raw-profile guards
passed, without a Node test heap override; coverage remains unparsed and
unadmitted. The current receipt is `current-c6033a71a-node/qualification.json`.
The earlier `db4e586d0` gate remains separately passed with 27,434 passes,
zero failures and 14 declared skips out of 27,448 tests.
The earlier `2f1ffce7f` run remains failed with 27,433 passes,
one nightly-payload import-closure failure and 14 skips. Earlier source-attributed
Node passes remain separate. The later native-selection draft repair (`2934d6a70`,
integrated as `8b2325853`) passed 22 unit controls and nine component cases across
Chromium, Firefox and WebKit. Untouched automatic headroom and exact native/keyboard
replacement pass; the controlled earlier failure remains failed and the historical
guide cause remains unproven. Those focused results postdate the `db4e586d0`
complete gates and retain separate source attribution.
Six native preparation phases on `c6033a71a` passed helper verification,
Motion/successor staging, unsigned directory packaging and resource verification.
All 1,946 generated files and the source/npm/prefix/prior-package guards passed;
17 recorded identities and six sessions were absent. At that preparation boundary,
the new packaged sandbox helpers were ordinary user-owned 0755 copies. This gate
ran no native/reference compiler, decoder or application workflow. The later
five-workflow installed aggregate on `c6033a71a` passed with 74 recorded identities
and seven sessions absent. Its separate broad-substring observer refusal remains
recorded with an unproven cause; the exact-scope reconciliation passed without
application replay. The same source's native 300/1,200-frame duration gate and
independent audit passed all six MOV picture/alpha, PCM and timestamp checks,
467 raw memory rows and 75 genuine encoder observations. Original memory limits
and cleanup gates passed. Browser, maximum and external AE/platform gates remain
open; none of these results qualifies later application changes.
The complete 32-case handbook browser gate passed on
`322c8a6b1`. That source's complete ordinary browser run closed failed:
7,228 passed, 48 failed and 287 skipped. The Motion-named subset passed 436
cases with two declared skips; this does not qualify shared behavior or the
whole suite. The older complete run on `3e8b3e942` remains failed: 7,215 passed,
40 failed and 287 skipped. The fresh linked suite
passed 38 of 39 cases, with one Chromium transient-playback polling failure;
the separate nine-case dual-origin suite passed all three engines. A sampling
repair then passed all six original mixed-preview cases with unchanged pixel
limits and timeouts. That focused result does not replace the failed full linked
run. The newer complete linked suite on `453f03c4b` also passed all six mixed
cases and finished with 38/39 passes. Its sole failure is now Chromium's Conform
review wait while project activation remained pending; all Firefox/WebKit cases
and source/site/process/writer guards passed. The activation delay is unresolved.
The fresh Linux five-workflow aggregate passed with an external Xvfb launcher that waits
for its owned child; this qualifies only the tested software-rendered x64
profile. The earlier strict aggregate failure remains recorded. The M06
keyboard repair and animated multilingual-title workflow
have focused evidence across all three engines. M08 final-export diagnostics and
an animated M09 camera reference now have focused checks. The coupled M10
saved-update/export regression is repaired and passes all three browser engines;
captured picture, PCM and originals remain pinned until cleanup completes.
Failed physical cleanup retains its retry capability. These focused results do
not close the combined gates. Combined coverage acceptance,
remaining regressions, broader workload/host and external gates remain open.
The controlled browser-duration check on `322c8a6b1` failed its existing memory ceiling
before completing the first preview frame; the rejected sample was not retained,
so the exact failing operand remains unknown. Two asynchronous touch-test
assertions are repaired and all five original Chromium workflows pass, with
native inputs and drag/Undo/Redo checks unchanged.
The sampler now retains the exact rejected operands on future memory refusals,
with the original limits unchanged; all 1,127 Motion tests pass on `7ae10f1b0`.
This diagnostic repair does not resolve or reinterpret the failed browser run.
A fresh unchanged-limit run on `7ae10f1b0` retained the rejecting operands:
aggregate RSS exceeded 2 GiB by 7,041,024 bytes, while PSS, JS heap and WASM stayed
within their limits. Allocation cause remains unknown. Four additive browser
diagnostics passed with original assertions and timeouts; they did not reproduce
or explain the earlier meter, spectral-menu, EQ and timeline failures.
A separate single-run diagnostic again exceeded the same RSS ceiling, by
9,338,880 bytes. Its later snapshot retained all 16 process records, with 12 CDP
roles identified; it does not establish the allocation cause.
Preview audio now opens its default AudioContext on Play (`d78e8401c`), avoiding
an eager output allocation when opening or seeking the visual preview. All
1,131 Motion Node cases and 15 focused browser cases across the three engines
pass on that source. Its fresh unchanged-limit duration run completed the entire
300-frame preview/PNG/WebM/cancel/retry workflow, then failed during the
1,200-frame preview: RSS exceeded 2 GiB by 1,724,416 bytes. Long exports and the
duration-tail comparison were not reached; that invocation remains failed.
The observer now retains already-returned backing/embedder and Linux
private/shared memory details (`036899f59`), without extra requests or changed
limits. All 1,179 Motion Node cases, full repository lint, strict Node-test
types, architecture/size checks and normal three-product builds pass on that
source. One fresh duration run passed both 300 and 1,200 frames, including all
preview/output/reference/cancel/retry/tail/cleanup checks. Its peak RSS was
2,029,117,440 bytes; all optional accounting fields were available. This is a
fixed software-profile pass, not an explanation of the earlier refusals or
complete application-browser/coverage acceptance.
Current-source Linux Motion and successor stages and unsigned directory
packages also pass resource verification, reusing the authenticated native
helper. The five-workflow installed aggregate then passed native launch,
animated scene, authored title, successor delivery and saved-file linking.
Its output, source, package and process-closure audits passed. This qualifies
the fixed Linux x64 software profile. The separate current-source native
duration invocation failed during the 300-frame encoder-cancellation retry:
the save chooser remained open after selection. The 1,200-frame workload and
independent output checks were not reached. Source, package, output-preservation
and process-closure audits passed; the chooser cause remains unknown. Current
maximum profiles passed separately as recorded below. Bounded passive chooser
observations now retain window, owner, focus and phase evidence for future runs;
27 offline controls pass with original actions and predicates unchanged. A
separate liveness repair treats a vanished `/proc` ESRCH read as absence; all
29 shutdown/observation controls pass while other read and signalling errors
remain failures. Neither change reinterprets or repeats the failed native run.
Maximum-workload fixtures, independent oracles and the bounded native driver
(`a4e851dc3`) are integrated as `2978ab0cc`. Installed source `322c8a6b1` passed
64×64 shutter/lens sampling, 64 contributing planes and 32 lights. The
32,768-frame export completed but failed its unchanged 64 MiB PSS-growth limit
by 3,879,424 bytes. Separate file-only verification passed every timestamp,
all 52,428,800 stereo PCM sample frames and selected pictures of that retained
movie; it does not clear the memory failure. All four original maximum profiles
then passed once each on `036899f59`, with unchanged actions, memory limits and
deadlines: shutter/lens quality with real shadows, 64 planes, 32 lights and the
32,768-frame index. The index passed refusal, cancellation/original-revision
retry, contiguous timestamps, exact stereo PCM and retained-memory checks;
PSS growth was 38,149,120 bytes against the unchanged 67,108,864-byte ceiling.
All source/package/helper/prefix and process/writer checks passed. This is
separate fixed Linux x64 software-profile evidence, not a cause or retrospective
clearance of the earlier failure. Two Conform diagnostic runs passed
the original workflow without reproducing its historical 15-second failure;
the second retained all 25 activation-phase pairs. No activation fix is claimed.
Earlier installed source `322c8a6b1` passed both 300 and 1,200 native frames,
including preview/ProRes, upload/encoder cancellation and retry, independent
picture/timestamp/exact-PCM checks, memory tails and cleanup. That result does
not close the browser, maximum-workload or broader platform gates.
The shared Amplify field now reserves native select-all draft intent before
pending automatic headroom can replace it (`3330272ef`, integrated as
`b91204a52`). Eleven Amplify controls, three existing keyboard/blur controls and
both real-controller browser cases in all three engines pass, as do strict
types, changed lint and the normal build. This fixes the reproduced keyboard
case; the historical full-suite Amplify failure has no established cause.
Installed After Effects validation is unavailable.
Earlier results below are historical; fresh results and failures are recorded in
[final validation status](motionscaper-final-integration-validation.md). Typed project contracts, atomic
history, deterministic evaluation, streamed `.mscape` archives, durable
saved/recovery storage, paragraph/vector rasterization, and linear-light CPU
and WebGL2 compositing have focused Motionscaper coverage. Menu-driven document
workflows, offline reopen, successor archive custody, and GPU context loss pass
in Chromium. Motion DB2 appends storage-only write leases; saved pointers and
recovery drafts are atomically fenced, and competing windows retain one authoring
owner. Motion File Open preserves foreign/future archives as private read-only
custody, with exact Save Copy and the previous document/history unchanged.
Same-identity File Open reviews Copy/Replace/Keep and Saved/Recover choices;
failed post-adoption native release retains an explicit cleanup retry.
The [packaged Linux native launch workflow](motionscaper-native-launch-qualification.md)
covers cold/warm OS arguments, original-file Save, deferred collision review,
opaque custody and renderer-reload reissue through main-private capabilities.
Lease release keeps its durable fence and navigator lock until deletion succeeds.
English/German Help-menu destinations open the Motion handbook through bounded
browser/native adapters. The desktop Help menu also offers a manual, bounded
own-tag release check with a verified repository link; release installation and
cross-platform updater qualification remain open. Retained imported Arabic and CJK fonts have shaping,
wrapping, pixel, portable-archive and offline-seek qualification.
M05 has a revision-pinned, cancellable render queue, menu-opened
worker preview and delivery, transparent PNG sequences, and browser MP4/WebM
round trips. The queue survives dialog closure and project switches, serializes
one renderer, and bounds retained intent and downloads. Retry retains the original
revision and obtains a fresh destination. Failed active native cancellation retains
the destination cleanup capability: **Retry Output Cleanup** must succeed before
removing the job or retrying its original revision. Queue disposal also retains
failed cleanup for another attempt. Header/publication failure and a real browser
render-to-queue workflow cover this ownership. Shared bounded PCM mixing, an audio sample clock, retained-media
decoding, and audio/video muxing pass a menu-driven media import, save/reopen,
preview, export, and re-import workflow. WebM declares its millisecond container
timing resolution. The separate float-carrier native helper and own-origin
desktop delivery pass a packaged Linux ProRes 4444 publication smoke test with
authenticated PCM24 audio. Other desktop targets remain unqualified. Flat MOV
delivery admits at most 32,768 frames so its retained sample index is bounded.
The [sustained drivers](motionscaper-sustained-browser-native-qualification.md)
measure worker preview, retained PCM and physical browser/native output as
duration grows. Fresh source `fa68087f7` passed the fixed 300/1,200-frame
software Chromium profile, including independent output, cancellation/retry,
memory and cleanup checks. Its native workload failed encoder observation after
300-frame delivery; output-only picture, timestamp and exact PCM checks passed.
The later source `5ca4a2ea1` attempt failed shutdown after three 300-frame movies.
Source `1202edeba` subsequently passed the complete fixed native profile at both
durations, including preview/ProRes, cancellation/retry, all six references,
memory tails and cleanup. The earlier c80 native success has lost receipts and
remains historical. Source `322c8a6b1` also passed this complete fixed native
profile, with all six independently decoded MOVs and 427 audited memory rows.
Its separate browser attempt failed the existing memory ceiling before completing
a preview frame. The four current maximum profiles have separate evidence above;
broader combinations and host qualification remain open.
Preview and render leases retain bounded digest-bound font providers.
M06 has menu-opened layer/audio timelines, property/keyframe editing, portable
clipboard commands, and exact source timing. Opt-in value/speed graphs and
spatial/path editing pass actual browser workflows, including pixel preview,
undo, and save/reopen. Ordered shape operators and shaped text animators have
actual CanvasKit and worker/CPU preview coverage and menu-opened operator editing.
Exact work areas, composition selection, retained cross-project clipboard, and
source timing/remapping pass browser editing, history and reopen workflows.
The opt-in Composition Canvas has direct selection, move/scale/rotate handles,
parent-coordinate conversion, keyboard controls and one-step Undo for static 2D
transforms. A maintained title-and-shape browser workflow combines retained fonts,
fill editing, canvas manipulation, eased curves, null parenting and nesting, then
saves/reopens and exports PNG pixels matching preview within one channel code.
M07 includes bounded local masks, ordered effects,
alpha/luma mattes, backdrop adjustments, revision-bound tracking commands, and
projective corner pins. Tracking freshness stops preview/export before resource
acquisition; point analysis/correction, planar pins, stabilization, cancellation,
history and reopen pass menu-driven workflows using actual encoded footage.
Keyed footage with a corrected animated mask, a tracked overlay and a planar
corner pin survive save/reopen and produce delivered PNG pixels identical to
the matching preview frames.
Menu-opened masks, effects, blend modes, mattes and adjustments pass browser
editing and property-animation workflows. Timeline layer lifecycle controls
rename without rebinding expressions, enable/disable picture layers, mute
retained footage audio and remove dependency-closed selections with atomic Undo.
Chromium verifies referenced opacity pixels, removal refusal and Save/reopen.
M08
includes a closed expression parser/interpreter, shared exact scene/audio
clocks, stable references, bounded queries, and atomic source/baking commands;
bounded native-PCM amplitude now drives preview/export pixels and mixed gain,
with asynchronous baking and expression asset custody. Menu-driven source
editing, diagnostics, evaluation and baking pass browser preview, history and
reopen workflows, including retained PCM amplitude and cancellation. M09 has perspective/orthographic cameras, depth-sorted translucent
planes, linear-SDR materials/lights, transparent shadow casters and deterministic
thin-lens sampling. Actual worker/WebGL and host/CPU preview fixtures agree;
matching-quality shutter/lens preview and final export agree, including exact
nested quality and arbitrary seeks. Menu-driven camera, lighting, material and
quality authoring pass actual Chromium preview, undo/redo and save/reopen.
The [packaged Linux scene qualification](motionscaper-native-scene-qualification.md)
drives real native file dialogs and the unchanged encoder, with authored camera,
light, shadow, shutter and lens quality. Software preview and decoded ProRes agree
within declared color/alpha bounds and retain exact rational frame timestamps.
Hardware GPU and remaining native platform qualification remain open.
The [Linux package CI gate](motionscaper-linux-ci-qualification.md) now requires
real native launch, this authored scene, authored title, offline successor
picture/PCM delivery and saved-file links for candidate/nightly Linux artifacts.
A complete local x64 aggregate on `1a788b61b` produced all five required
source-bound receipts. The complete aggregate admits x64; ARM64 and other targets
still need actual receipts; configuring those jobs does not qualify them.
M10 has versioned composition
offers, bounded streamed closure verification, compatible/pending update and
Undo/Resume rules, and atomic receiver-owned successor storage with retained
historical revisions, with atomic owning-project/history CAS and private
preparations. Saved-revision picture and PCM adapters use the shared scene and
retained bytes after offline receiver reopen. An active native delivery retains
its captured revision and independent audio resources when a compatible saved
revision is accepted. Focused controller and three-engine browser checks cover
the concurrent update, exact old/new picture and PCM, retained originals and
cleanup before publication; failed physical cleanup remains retryable.
The explicit successor browser
shell exposes composition connections through File, with paired picture/PCM
placement, atomic editing and Undo/Redo, and lazy exact preview/delivery.
Authenticated generated video sources pass the actual Frame finishing exporter
without encoded proxy bodies. Fresh and edited family-v2 archives export and
import with retained ordinary media and linked closure; Chromium covers failed
publication, retry, reopen, deliberate media-cache loss and portable re-export.
The successor site builds within unchanged startup and chunk limits. Generated
bin thumbnails, exact filmstrips and muted source-monitor Play/Pause/Mark use
the retained renderer without encoded proxy URLs. Standard File Copy/Replace
retain original archives, rebind conflicting ordinary media and fence atomic
owner publication; focused tests cover complete cache recovery and prior-v1
custody. The dedicated real-editor browser gate covers saved sender updates,
Undo/Resume, width Conform, portable File Save/Open and offline reopen. Actual
video delivery now passes fresh portable reopen and decoded MP4 pixels matching
the blue preview. Duration/FPS Conform has an exact fit-window review, unchanged
intent on Cancel, stale-review refusal, atomic Apply and one-step Undo. The
packaged Linux x64 GTK/X11 saved-file link passes actual chooser, watch-generation,
closed-dialog update, corruption refusal and Disconnect custody checks. Native
generated-source delivery now has a real [Linux package qualification](motionscaper-successor-native-delivery.md):
offline owner reopen after removing the original source, actual GTK Save,
authenticated ProRes pictures and mixed PCM, exact timing and decoded pixels
matching the software WebGL preview within one display code. A subsequent actual
Chromium workflow verifies complete CPU finishing preview for retained linked
compositions when WebGL is unavailable or loses its context, context restoration,
offline receiver reload, and clearing the picture for a new document. Preview
converts declared Rec.709 finishing bytes to sRGB without changing delivery bytes.
Complete CPU finishing also covers retained timeline-image layers mixed with
linked scenes, through the same authenticated supplemental-picture executor as
export. Actual Chromium disables WebGL2 globally and verifies File Open,
animated-image playback, Stop, reopen and project replacement. Exact NTSC
random-seek pixels match export in either painter order. Inherited Frame
adjustment effects that require WebGL2 remain an explicit unavailable-render
error when WebGL2 is absent; no incomplete frame is reported as rendered.
The remaining native platform matrix remains unfinished.
M11 has a bounded
exchange schema, custody/report validation, readable installed-AE exporter and
limited importer scripts with media digest verification, a bounded script
download, explicit numeric sampling and limited editable exchange conversion.
Editable path geometry and hard-edge masks have bidirectional conversion,
closed host metadata, readable ES3 scripts, and a real Chromium bridge
import/pixel/save/reverse-package workflow. Unsupported temporal/path topology,
feathering and expansion remain explicitly reported.
Normal, Multiply, Screen, Overlay, Darken, Lighten and Difference have closed
bidirectional blend mappings with readable host preflight and readback. Chromium
verifies import pixels, Save/reopen and reverse packages. Non-neutral compositing
switches, adjustment/3D semantics and other blends remain inert report items
with original custody. These structural checks do not establish installed-AE
blend or color/alpha parity.
Gaussian Blur 2 exchange requires an explicitly selected reviewed profile for
the exact AE version, build and language, with a complete bounded neutral control
tree and a declared blurriness-to-sigma scale. Readable calibration/export/import
scripts verify fresh AV switches, effect controls, authored hold/linear keys and
readback, rolling back failed writes. The File workflow verifies mismatch refusal,
review invalidation, Save/reopen custody and reverse-package values. This is a
structural editable subset; installed-AE kernel, bounds, color and alpha parity
remain unqualified, with complete rendered fallback available.
Reviewed editable paragraph text includes retained font bytes, explicit PostScript
bindings, source custody and a real Chromium import/save/reopen/reverse-package
workflow. The readable host importer preflights fonts before mutation and requires
AE 24.6 or newer for text. Ordered shape project conversion is wired in both
directions; readable installed-host shape creation preflights an exact reviewed
version/build/language style profile, ordered path/paint operations and admitted
keys before mutation. Named style readback failures roll back new objects.
Separate menu-dialog expression opt-ins translate closed scalar opacity syntax
with explicit percentage units and preserved keys/source custody. Independent
ES3 validation precedes host activation, with error/nonfinite checks at one
bounded sample and owned-object rollback. Chromium exchange and Save/reopen
reproduce the authored opacity pixels. These structural checks do not qualify
installed AE expression, style, color or subframe fidelity.
Atomic import retains original exchange/report custody and every media file
through normal Save/reopen and portable archives, including unsupported null
placeholders. The opt-in File bridge workflow passes actual Chromium import,
preview-pixel, save/reopen, original-media custody and refusal checks; AEP/AEPX
selection routes to installed-AE guidance. The explicit whole-composition PNG
fallback has a bounded installed-host adapter, generated entry and complete
256-frame image-layer carrier with distinct-frame Chromium pixel checks.
The reverse [rendered Motion-to-AE transfer](motionscaper-ae-render-transfer-qualification.md)
uses full authored shutter/lens quality at every frame, verifies frame bytes
against normal PNG delivery, and retains the complete original project and
source media. Refusal, cancellation and failed output cleanup publish no package.
Installed-AE settings/cancellation/color/alpha and actual export/re-import
reference qualification remain unfinished. Additional composition authoring passes an actual nested picture/PCM
preview and save/reopen workflow; retained font and gradient authoring pass
Chromium pixel/history workflows.
Fresh source `3e8b3e942` Motion Node tests passed all 1,086 cases without skips.
The complete five-partition run failed two existing-product/cross-product cases:
desktop AudioWorklet deadline admission and paired-download test synchronization.
The latter has a focused test repair; the desktop failure's cause remains unknown.
Source `1887abecc` subsequently qualified all 45 linked/dual-origin browser cases
without skips or retries. Source `1202edeba` qualified both fixed native duration
workloads, with all six MOV references, memory samples and cleanup audited.
These source-attributed results do not replace complete combined acceptance.
The complete source-328 browser run passed all 139 Motion-named Chromium cases
but failed existing-product workflows; current combined acceptance remains open.
These results do not close a package; complete accepted coverage remains pending.
The [platform fixture](motionscaper-platform-qualification.md) passes twelve
actual Chromium, Firefox and Linux WebKit workflows covering keyboard menus,
retained fonts, authored keys, Save/reopen, same-engine PNG/preview and offline
reopen with the origin shut down. Chromium and Firefox produce actual VP9 WebM;
Linux WebKit refuses before an independently reproduced native encoder crash.
Different engines' whole-frame hashes are not claimed identical. Broader maximum
combinations, full existing-product regression, hardware GPU, macOS Safari and
credentialed native distribution still require their own gates.
The capability register owns Motion's independent workspace and bounded claims.
Own Pages tables, stable-release and source-bound deployment preparation exist;
activation/publication and credentialed target qualification remain separate.

The current [2.5D rendering contract](motionscaper-2-5d-rendering.md) declares
M09's camera, depth-group, lighting and quality semantics. It does not claim
After Effects pixel parity.

The current [composition link foundations](motionscaper-composition-links.md)
declare M10's revision, closure, history and rendering authority. Fresh
bounded Linux delivery, complete linked/dual-origin suites and fixed native
duration have source-attributed evidence in the final validation status.
Combined regression/coverage acceptance, broader workload combinations, remaining
targets and hardware qualification remain open.

During implementation, run only Motionscaper-specific tests. Run the complete
repository and existing-product regression gates at M12. Keep at most ten
task worktrees active and remove each after its work is integrated and it is
no longer needed. The integration worktree is `Soundscaper-motionscaper`.

## M01. Product registration and platform seams

**Deliverables:** register `motionscaper` throughout product identity, profiles,
capabilities, bootstrap selection, build aliases, release lines, routes, offline
shells, icons, locale handling, handbook generation, desktop packaging, and CI.
Replace binary product/peer switches with explicit product selection. Preserve
the reserved Lightscaper suffix and its separate roadmap scope.

Give Motionscaper separate storage and lock namespaces, desktop user data,
scheme, updater identity, and native-service admission. Use
`org.motionscaper.desktop` as the application ID and `motionscaper.org` as the
default configurable web origin. Domain provisioning and publication follow
the existing release process; normal editing requires no cloud account.
Add a Motionscaper Node-test owner and browser/desktop test-site support.

**Completion gate:** the browser and packaged desktop shells boot with the
correct identity; existing products still boot; libraries and locks are
isolated; build selection includes only the intended product bootstrap. Motion
capabilities remain unavailable until their owning packages land.

## M02. Project, asset, and migration contracts

**Deliverables:** introduce `{ schemaFamily: 'motionscaper', schemaVersion: 1 }`
and `.mscape`, using Scape container format 1. Define typed compositions,
ordered layers, parent/precomposition relationships, property animation,
media/font assets, and immutable revisions. Layer kinds cover footage, images,
text, shapes, solids, nulls, adjustments, precompositions, cameras, and lights.
Keep renderer state and source-discovery capabilities out of persisted intent.

Own validation, commands, history, storage, project locks, asset retention, and
archive assembly through a Motionscaper runtime profile. Preserve foreign/future
families under the established read-only custody rules; suffixes are routing
hints, never schema authority.

Introduce Framescaper family v2 on the **1.1 successor development line**, with
a typed source-to-composition link relation. Replace the global current-schema
version with per-family versions. Soundscaper remains family v1. Migrate
Framescaper v1 transactionally into the successor namespace, retaining the
original bytes and project identity and recovering idempotently after
interruption. Do not put this schema change into the current Framescaper 1.0
RC/stable line.

A link records stable project/composition identity, accepted revision and
digest, output timing/canvas/color/alpha contract, and a content-addressed
snapshot with its complete dependencies. Paths, handles, tokens, and transport
sessions remain platform-local. Do not hide executable link semantics in
`opaqueExtensions`.

**Completion gate:** ordinary and malformed projects, archive round trips,
foreign/future custody, asset retention, and interrupted migrations are tested.
A saved composition preserves all declared layer/property kinds, even before
their authoring UI is enabled. Existing family-v1 archives stay recoverable.

## M03. Composition evaluation

**Deliverables:** compile a revision into a cycle-checked composition/property
graph and evaluate it at exact rational time. Resolve layer timing, parenting,
precompositions, animation, time remapping, audio synchronization, and effect
order into renderer-neutral frame state. Add typed scalar, vector, color, and
path animation; reuse existing timing and scalar interpolation primitives.

Use the same evaluator for playback, arbitrary seeking, thumbnails, offline
export, and linked Framescaper sources. Declare effect/mask/transform ordering
once and produce a consumption ledger so a renderer cannot silently omit
authored operations. Expression and 2.5D implementations extend this graph in
M08/M09 rather than creating a second evaluator.

**Completion gate:** nested/mixed-rate timing, parent transforms, cycle
rejection, retiming, and evaluation after random seeks agree across consumers.
Trim, split, clipboard, undo/redo, and save/reopen preserve animation authority.

## M04. Typography, vectors, and 2D rasterization

**Deliverables:** add pinned, lazily loaded CanvasKit WASM for real paragraph
shaping and vector rasterization. Bundle licensed fallback fonts and retain
imported font bytes as digest-bound assets; system font availability is not
document authority. Replace the placeholder-glyph path for Motionscaper.

Rasterize text, primitives, Bezier paths, fills, strokes, gradients, clipping,
and isolated precomposition surfaces. Add the dedicated WebGL2 composition
renderer using linear-light SDR, floating-point working surfaces, premultiplied
alpha, and explicit output conversion. Provide a CPU reference/fallback path
with the same composition semantics.

**Completion gate:** readable multilingual text, ligatures, line wrapping,
font portability, vector geometry, blend formulas, and alpha edges have
reference-frame coverage. Preview and full-quality rasterization agree at the
same time, resolution, and quality settings. Runtime assets load lazily and
remain available offline after installation/caching.

## M05. Preview, delivery, and render queue

**Deliverables:** connect the evaluator and renderer to preview/playback and
export through bounded decode/render queues. Add minimal menu actions to create
a composition and add media, text, and shapes so this package's workflow is
usable before the full M06 authoring workspace. Use a persistent worker and
OffscreenCanvas where supported, with a canvas-host adapter otherwise. Include
seeking, cache eviction, cancellation, context-loss recovery, and progress in
the menu-opened workflow.

Deliver browser MP4/WebM plus transparent PNG sequences, and desktop ProRes
4444 through the existing native delivery services. Add a separately versioned
high-precision native frame adapter with explicit color/alpha metadata; retain
the existing RGBA8 contract. Pin one project revision for each render task and
retain its dependency closure until completion/cancellation.

**Completion gate:** a user creates, saves, previews, and exports a basic
composition through menus on both platforms. Reference frames and transparent
output round trips agree; cancellation and recovery leave no partial project
publication; memory remains bounded as output duration grows.

## M06. Layer and animation authoring

**Deliverables:** implement the menu-opened composition/layer workspace,
selection and direct manipulation, property inspection, layer order/timing,
parenting/nulls, precomposition creation, time remapping, audio playback,
work areas, duplication, and clipboard workflows.

Add graphical value/speed editors, keyframe selection and transfer, hold,
linear, eased, and Bezier interpolation, and editable spatial motion paths.
Add shape operators for trim paths, repeaters, boolean operations, and
compatible-path morphing. Reject incompatible morph topology with an actionable
diagnostic. Text animators operate on shaped character clusters, words, and
lines and expose position, scale, rotation, opacity, color, and tracking.

**Completion gate:** a maintained browser workflow builds a readable animated
title and shape composition, edits its curves, parents it to a null, nests it,
saves/reopens it, and exports it. Undo/redo, keyboard navigation, focus,
accessible controls, and shaping-preserving text animation are covered.

## M07. Compositing and motion-design VFX

**Deliverables:** expose animated masks, feathering, alpha/luma mattes, blend
modes, adjustment layers, and ordered effect stacks. Reuse registered effects
through narrow adapters and preserve their native/platform availability rules.

Reuse point tracking and stabilization foundations; add planar tracking and
corner pinning. Provide chroma keying and editable animated-mask workflows with
manual corrections. Bind analysis results to source/settings digests and
surface stale analysis before applying or exporting it.

**Completion gate:** tracked overlays, planar corner pins, keyed footage, and
manually corrected masks survive history and reopen and render identically in
preview/export. Missing mattes, cyclic references, stale analysis, and
unavailable effects produce explicit diagnostics without losing authored state.

## M08. Expressions and procedural animation

**Deliverables:** parse and interpret a closed JavaScript-style AST supporting
arithmetic, vectors, conditionals, typed property links, time, `valueAtTime`,
looping, easing, seeded random/noise/wiggle, and audio amplitude. Resolve
property links to stable identities. Detect cycles and bound evaluation work.

Expose expression editing, diagnostics, and baking through menus. Keep invalid
expressions editable; block final export with actionable errors. Expressions
have no DOM, network, filesystem, arbitrary imports, host `eval`, or mutable
state carried between evaluated frames.

**Completion gate:** seeking and sequential rendering yield the same values;
renaming referenced layers preserves links; cycles, malformed expressions,
resource exhaustion, cancellation, audio timing, and baking are tested.

## M09. 2.5D cameras, lights, and temporal rendering

**Deliverables:** extend evaluated layers with 3D transforms and material
response; add perspective/orthographic cameras, ambient/point/spot lights,
shadows, depth of field, and depth-aware compositing of translucent planes.
Keep precompositions isolated and transform their output as a layer.

Motion blur evaluates the scene within a declared shutter interval. Preview
may use explicitly reduced quality; final rendering uses the selected output
quality. Temporal sampling must preserve expression determinism and remain
independent of prior playback.

**Completion gate:** camera animation, parented 3D layers, intersecting
translucent planes, shadows, depth of field, and motion blur have reference
fixtures. Matching-quality preview/export results agree on browser and desktop;
unsupported GPU capabilities take the declared fallback or report refusal.

## M10. Linked Framescaper compositions

**Deliverables:** implement a separate versioned link protocol. Browser
linking opens a dedicated top-level bridge, verifies the peer origin/window,
and uses same-origin communication with its own editor. Preserve editor COOP/
COEP isolation and product library separation. Desktop linking watches an
explicitly selected `.mscape` through main-process capabilities, including
authorized atomic file replacement and generation renewal.

Explicit successful Save publishes a revision; recovery autosaves do not.
On desktop, normal Save updates the bound `.mscape` before publication. On the
web, publication follows durable project commit. Transfer and validate the
immutable snapshot and complete asset closure before accepting an update.

Framescaper places/trims/retimes/finishes the linked source; Motionscaper edits
its contents. Accept compatible saved revisions automatically while connected,
as one undo step. Timing, dimensions, or duration changes remain pending until
a menu-driven conform action. Undo pauses that link's automatic acceptance
until Resume. Renaming a composition preserves its link; deletion, disconnect,
save failure, and corrupt/partial updates preserve the accepted revision.

Route linked sources through the shared evaluator in both preview and final
export, including native delivery. Retain snapshots/assets referenced by
history or active exports. Archives package the entire closure for offline
rendering; destination ownership remaps without changing external composition
identity. Allow Motionscaper-to-Framescaper render dependencies initially and
reject cycles. Exports pin their starting revision throughout the task.

**Completion gate:** saved edits update a connected Framescaper project;
closing Motionscaper leaves preview/export working. Test offline archive
reopen, reconnect, interrupted transfer, atomic saves, incompatible updates,
undo/resume, concurrent export, asset retention, and cross-origin isolation.

## M11. After Effects interchange bridge

**Deliverables:** provide readable ExtendScript exporter/importer scripts run
through installed After Effects and a versioned exchange package with media
references. Reconstruct supported compositions, footage, parenting, transforms,
keyframes/easing, text, shape paths, masks/mattes, cameras, lights, blend modes,
and explicitly mapped effects as editable content.

Translate the supported expression subset. Offer sampled keyframes or
AE-rendered media for unsupported constructs; bake a complete composition when
cross-layer dependencies make layer-level baking incorrect. Preserve source
projects and emit a report distinguishing editable, sampled, rendered, and
unsupported content, including missing media/fonts. Direct `.aep` selection
leads to the bridge workflow rather than claiming native project support.

**Completion gate:** real AE-generated fixtures and actual AE re-imports
qualify the supported subset. Compare editable structure and reference frames;
test missing assets, unsupported plug-ins, expression baking, repeat transfers,
and source preservation. Publish the tested AE version/feature matrix. Mocks
alone cannot close this package; unavailable AE qualification remains an
explicit incomplete gate.

## M12. Distribution and release qualification

**Deliverables:** finish browser/offline and Electron distributions, signing,
updater configuration, icons, file associations, help links, English/German
copy, generated translations, and handbook workflows. Register implemented
capabilities and their evidence in the owning machine-readable policies.
Preserve third-party notices, source pins, and reproducibility workflows.

Use Node 26.5.0 and npm 12.0.1, preserve `package-lock.json`, and update it with
dependency metadata. Keep FFmpeg runtime assets outside the Pages bundle and
retain semantic chunk ownership. Add a Motionscaper startup budget under the
existing family maxima; preserve initial-page and existing-product ceilings,
the 500,000-byte JavaScript chunk limit, file-size ratchets, and coverage floors.

**Completion gate:** run `npm run lint:changed`, full lint for the shared
type/configuration/dependency changes, `npm run check`, `npm run test:browser`,
and appropriate packaged-desktop qualification. Exercise complete editing,
delivery, linking, Adobe exchange, keyboard/accessibility, and existing-product
regressions. Update generated references and translations through their tools,
regenerate policy narratives from registers, and repin digest-bound runtime
evidence when its owning files change. The first-release gate closes only when
M01–M11 and these automated/compatibility gates are complete; publication uses
the [existing release process](../operations/release.md).

## Runtime asset handoff

This implementation-order document and the agreed scope do **not** require a
manual **Update AI assets** run: no assistance-engine closure change is planned.
CanvasKit and native rendering changes require their own asset builds and
audits. Reassess the AI-assets requirement if implementation changes assistance
runtime source pins, recipes, patches, bundled dependencies, archive/signing
logic, or target inventories. If required, use the AGENTS.md handoff procedure
and commit the refreshed desktop-test runtime snapshots.

## Reference contracts

- [Architecture and maintainability](../architecture/overview.md)
- [Time and media](../architecture/time-and-media.md)
- [Production and rendering](../architecture/production-rendering.md)
- [Native services](../architecture/native-services.md)
- [Delivery and interchange](../architecture/delivery-and-interchange.md)
- [Family-v1 baseline](../decisions/project-family-v1.md)
- [Product origins and handoff](../decisions/product-origins.md)
- [Project compatibility](../policies/project-compatibility.md)
- [CanvasKit documentation](https://docs.skia.org/docs/user/modules/canvaskit/)
- [Adobe project formats](https://helpx.adobe.com/mena_en/after-effects/desktop/work-with-projects/after-effects-projects/projects.html)
- [Adobe script workflow](https://helpx.adobe.com/after-effects/desktop/automate-in-after-effects/automate-animation/scripts.html)
- [Adobe SDK third-party-host limitations](https://ae-plugins.docsforadobe.dev/ppro/other-hosts/)
