# Motionscaper final integration status

Status: **M01–M12 In progress**, updated 2026-10-22. **No milestone is accepted**.
Engineering completion is estimated at **about 90%**; release acceptance remains
open.

The latest complete Node and browser-build checkpoint is `bc586f975`, a two-file,
six-line fixture correction after application checkpoint `0282106d9`. The
production application, native inputs, package inputs and dependencies are
unchanged. Completed results retain their actual source revisions below.

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

## Historical validation evidence

The preview repair (`d7f9f655f`) passes 84 focused Motion cases, full strict
types, full and changed-file lint, size and controller ownership checks.
Validated completed work renews only the 30-second inactivity deadline; the
600-second absolute frame deadline remains fixed. Cancellation drains before
worker reuse. Absolute exhaustion remains an error, with worker recreation
reserved for a later request.

The complete Node run on frozen source `aeec86704665` closed failed:
27,940 tests, 27,923 passes, three failures and 14 declared skips. All 1,250
Motion tests passed, including the pinned real native MOV alpha/PCM checks.
The three shared failures have focused corrections:

- `6c601aea3`: preview watchdog/drain modules stay in the lazy `motion-domain`
  chunk. The new regression failed before the correction; all 40 focused
  chunk, worker and reachability checks pass afterward. The original startup
  invariant and 500,000-byte chunk ceiling remain unchanged.
- `6939c9572`: Motion CI selects native tooling and Node architecture for each
  target, including Windows ARM64 without the unsupported Chocolatey path.
  All 19 focused checks pass; this is not actual Windows or macOS execution.
- `6ab2c71d4`: the nightly browser contract includes all four product sites.
  All 12 focused checks pass. A fresh full Node gate remains required.

The ordinary browser invocation on frozen source `aeec86704665` closed failed:
7,119 passes, 307 declared skips and 113 failures, with zero retries or flaky
results. All 7,539 discovered identities are accounted for. The Motion portion
has 418 passes, seven declared skips and 19 failures: Chromium 131/0/17,
Firefox 140/6/2 and WebKit 147/1/0 (pass/skip/fail).
These include Project Bin relinking, original-file overwrite readiness,
initial navigation, tempo entry, Motion preview and PNG delivery, and audio
editor workflows. Each retains its original failed result; saved evidence
has not established a common cause.
The overwrite fixture now waits for the public import-ready state before
opening the menu (`f4b64a747`); all six focused scenarios pass across Chromium,
Firefox and WebKit. One unchanged relink diagnostic and one unchanged tempo
scenario also passed, which does not explain their original failures.
`010e53c33` adds passive, bounded failure-only keyboard/input diagnostics to the
two WebKit tempo cases. Strict browser types, changed-file lint and controlled
blank-page plumbing checks pass; original keys, assertions and timers are
unchanged. This adds evidence collection, not a product fix or a cause claim.
The independent audit passed input/site/map preservation, recorded-process
retirement and port closure. The original audio service had already exited;
its exit time and reason remain unknown, and its absence is a failed post.
This does not establish a common cause of the browser failures.
The other product browser failures remain unresolved. Failed raw coverage stays opaque
and unadmitted; no current complete browser or coverage acceptance is claimed.

On source `6ab2c71d4801375b62ee48d1ea4a54b7954cebc3`, the packaged Linux x64
five-workflow aggregate passed launch, scene, authored-title, successor delivery
and saved-link workflows. The original 300/1,200-frame, 160×90, 30 fps native
duration workload also passed. Its independent audit verifies selected picture
and alpha bounds, all frame/audio timestamps, exact 48 kHz stereo PCM, memory
growth, cancellation/recovery, retained outputs and physical/process closure.
Both applications exited with code zero. The aggregate's older launch/scene/
successor scripts retain their original per-Electron exit-code observation
limitation; the duration's strict application results do not broaden that claim.
On the same source, the original maximum-quality, 64-plane and 32-light
workloads passed their independent picture, alpha, timestamp, memory and
closure checks. The 32,768-frame index workload failed its original retained
PSS-growth limit: 70,405,632 bytes exceeded 67,108,864 bytes. It rendered all
frames, but independent picture, alpha, exact PCM and timestamp qualification
had not run. Its physical/source/artifact/process audit passed; the export
remains unqualified. Original limits, measurement windows and failures remain
unchanged. Temporary Linux sandbox helper custody was fully restored and
independently checked.

Source `0241c6e1c` passed the complete `npm run check:static` gate, including
its input and process audit. Source `feabe1b3c` also passed the complete static
gate, independent input/process post and generated-artifact audit: 52,066
unchanged input records, 11,777 generated files, no startup-budget changes and a
largest JavaScript chunk of 488,189 bytes. The command completed in 717.9 seconds
within its unchanged 1,200-second bound. This does not establish full Node,
browser, native-interop or package acceptance. Source `6463b7e69` fixes production
export audio cache retention: each successful block releases unused historical
windows, while the global 16 MiB budget and preview LRU behavior remain unchanged.
The production-path regression failed before the correction; all 46 focused
Motion cases, strict test and Motion production types, changed-file lint and
the Motion browser build pass. Exact PCM joins, simultaneous source windows,
cancellation and preview seeking remain covered. Full repository lint also
passed on the final five working-file bodies; the commit occurred during lint
without changing those bodies. The original index workload has not yet
qualified this source. Focused checks do not establish the full retained-memory
cause or acceptance. A new private-project package attempt on this source
passed native verification and the staging producer, then failed dependency
lookup during packaging; final stage/package verification did not run. Its
independent input, artifact and process audit passed. The next package run uses
the normal project directory and its existing dependency lookup.

The first-paint readiness repair (`286fe818`) keeps preview controls disabled
and the status working until the current project has published a painted frame.
Its mounted-dialog regression fails on the unchanged UI for delayed first
frames and project replacement; the immediate-frame control passes. All 43
focused preview cases, changed-file lint, strict test types, the Motion build
and the unchanged existing Chromium preview workflow pass. The initial static
typecheck exhausted its default heap; the bounded 12 GiB static invocation
passed. Application tests retain the default heap. This repairs the readiness
contract without establishing the cause of historical browser timeouts.

The Canvas readiness repair (`92a5abdd`) authorizes new edits only after the
current project, composition and exact frame have painted in the current asset
store session. Draft paints replace the recorded pixels; cancelling a painted
draft waits for the base frame to repaint. Replacing the project or store also
cancels its gesture and releases pointer capture. All 28 focused controls,
strict focused and Motion production types, changed-file lint, size, the Motion
build and both unchanged Canvas Chromium workflows pass. The broad test
typecheck exhausted its default heap and remains failed; the focused check
does not replace it. No historical browser failure is attributed to this defect.

The audio repairs (`26de1c9b`, `1d586e7b`) let Pause release a suspended audio
resume without detaching an actual mixer flight. Late old resume results cannot
start playback or report stale errors. Video starts synchronously after PCM
priming, before scheduling can advance the shared sample clock. The mounted
regression reproduces both the delayed frame and playback remaining active at
the final sample before the fix. All 24 focused controls, strict focused and
Motion production types, lint, size, the Motion build and both unchanged
Chromium preview/audio workflows pass.

The raster runtime repair (`df8fffea7`) makes consumer cancellation settle while
shared initialization remains pending. It preserves other consumers and retry
after initialization failure, and observes late rejection even when setup
aborts synchronously. All 30 focused controls, strict focused and Motion
production types, changed-file lint and size checks pass. On integrated source
`7b804853d`, all 49 selected Canvas, audio, preview and raster controls pass
together. These source-predicted defects have controlled regressions; their
role in the historical browser failures remains unproven.

The fresh ordinary Motion browser component on `7b804853d` passes all 444
discovered identities: Chromium 148 passes, Firefox 142 passes/six declared
skips and WebKit 147 passes/one declared skip. There are no failures, flaky
results or retries. Five skips declare unavailable Firefox WebGL2; two declare
the Chromium-only OPFS duration profile. The original assertions, timeouts,
worker topology and default application heap remain unchanged. Independent
source/npm/control/site/map checks and physical closure pass, with all 932
recorded identities retired and all three ports free. The private audio service
was deliberately held for later suites. This is the ordinary Motion component;
complete all-product and coverage acceptance remain open.

The separate maintained linked-editor component on the same `7b804853d` source
passes all 13 Chromium cases across its six files, without skips, failures, flaky
results or retries. The current configuration is Chromium-only with one worker;
this is not a 39-case or three-engine result. Original assertions, case/action
timeouts and the default heap remain unchanged. Independent source/npm/control/
site/map preservation and final physical closure pass, with all 31 recorded
identities retired and both ports free. The initial post observed a retained
TCP TIME_WAIT entry and could not bind one port; that observation remains
recorded. A later read-only post verifies closure after natural expiry, without
replaying the tests. Qualified ordinary and linked sites remain preserved.
The private audio service was alive at those closures. A later observation finds
its original process absent; its exit time and cause are unknown. Another
browser invocation requires fresh audio-service readiness.

The original Windows x64 build on source `0241c6e1c` failed at libvpx because
the assembler was unavailable. After the NASM installation/PATH corrections
(`d41fbcd5`, `0e227882`), a new build found NASM but failed because libvpx was
on the wrong compiler/linker path. Both failed builds retain their independent
source, tool, artifact and process audits; neither reached the Motion host,
self-tests or result verifier. The recipe correction (`fe40fc1b`) selects the
pinned upstream MSVC project path only for Windows libvpx. Its five target-plan
controls and 14 focused Motion checks, strict types, changed-file lint and both
source audits pass. Its native build reached VS mode, then failed because
native Make could not resolve the persisted shell-style source path.
The path correction (`9c82c30a`) retains native forward-slash source and install
paths. Its two drive-root regressions fail before the fix; all 16 focused Motion
checks, strict types, changed-file lint and source audits pass afterward.
The next native build resolves the includes and selects VS project mode, then
fails launching `gen_msvs_def.sh`. It does not reach host compilation, CTest,
self-tests or result verification. The four failed builds and their independent
source, tool, artifact and process audits remain preserved.

The shell correction (`8d20985b`) binds the full authenticated Bash path and
normal shell flags only for Windows libvpx build/install. Its two Windows
regressions fail before the fix; all 16 focused Motion checks, strict types,
changed-file lint and source audits pass afterward. A separate bounded native
Make control passed generator output, recursive Make and installation with the
same shell arguments. This does not establish complete native compilation or a
new Linux native receipt.

The fifth Windows attempt generates the short headers and export file, then
fails launching the real `vpx.vcxproj` generator with Windows error 87. Its
rendered diagnostic spans 41,759 UTF-16 code units; the actual process-creation
buffer was not intercepted. No project file or libvpx compilation is produced.
The verified source-staging correction (`28e84651`) uses a short relative source
path independently of the original drive or directory depth. All 22 focused
Motion checks pass on Windows, including 13 staging/target controls; strict
types, changed-file lint and source audits pass. Linux passes 20 checks and
declares two Windows execution skips. The real long-generator control then
returns Make success but fails its independent semantic check: the project
contains only 157 of 245 required file references. Its exact missing-reference
check rejects the output; the negative control is consequently not run.
Independent input and process audits pass. The truncation boundary remains
unproven.

The nested-source correction (`a2623b2d`) stages the same verified tree under
`libvpx-build/src` and retains `src/configure`. All 22 focused Windows controls
pass. Its actual generator control preserves the upstream command grouping and
produces exactly 245 references: 104 compile, 129 header, one assembly and 11
other files, with both x64 configurations, the v143 toolset, static CRT and 104
unique compile object names. The separate full-command-line failure control
returns Make status two, reports the fixed recipe's Error 7 and does not run
the later recipe. Independent source/tool/artifact/process audits pass; all
five failed native builds and earlier canaries remain unchanged. This validates
the generator route, and the complete native build remains required.
The separate FFmpeg path correction (`9f24c039`) copies and authenticates the
original FFmpeg tree against its existing manifest pin before any command. On
Windows it uses the upstream `./src` configure branch, native install paths and
the full authenticated shell arguments for Make. All 29 focused Windows
controls, strict types, changed-file lint and source audits pass; Linux passes
27 checks and declares three Windows execution skips. The raw source witnesses
and receipt bytes retain their original identity. This repairs a source-predicted
handoff defect; no actual FFmpeg configure or complete native pass is claimed.
The refreshed shared native manifests also require a fresh Linux native build
and receipt before new packaging. Earlier native results retain their original
source identities; they are not retagged or reused against the changed closure.
The assistance runtime closure is unchanged.

The subsequent Windows x64 attempt on `9f24c039` compiles and installs zlib,
x264, x265, libvpx and Opus, including the complete 245-reference libvpx project.
It reaches its unchanged inherited deadline after 406.5 seconds. The owner
reports a timeout-cleanup failure before retaining the builder's numerical exit;
that exit remains unknown. Independent input/artifact/process checks pass and
the recorded timeout descendants are absent. No FFmpeg configure, host,
self-test or final-result pass is claimed. The failed attempt remains preserved;
a separate fresh attempt uses the original 180-minute execution bound from its
own launch, with fresh work/results and the same source, tools and recipe.

That fresh attempt on `9f24c039` again compiles and installs all five codec
libraries, then exits with numerical status one during FFmpeg configure,
before its original 180-minute deadline. The actual configure log finds the
x265 package and compiles its header control, then fails linking `x265.lib`;
the MSVC installation contains `x265-static.lib` and the package metadata requests
`-lx265`. No host, self-test or final-result pass is claimed. Its initial post
mistakenly inspected the previous attempt's work/result paths; that provisional
review remains unaccepted. The corrected read-only post authenticates the actual
12,718-file work tree, absent result root, unchanged earlier failures/canaries
and final process closure. It does not replay or qualify the failed build.

The normalization correction (`e6d808362`, integrated in `58b0e19c7`) adds a
Windows-only authenticated CMake copy from `x265-static.lib` to `x265.lib`
immediately after installation. It retains the original archive, package
metadata, source pins, CRT and POSIX command sequences. The missing-phase and
real recipe-driver controls fail before the change; all 35 focused Motion cases
pass on Windows afterward. The integrated Linux run passes 31 controls and
declares four Windows execution skips, with the default heap and no retries.
Strict focused types, changed-file lint and source audits pass. The existing
Framescaper phase-array assertion receives its required one-line expectation
update without growing the frozen file; its rerun is deferred to the final full
suite. The changed shared manifests require another fresh Linux and Windows
native build; the earlier successful Linux receipt keeps its actual identity.

The subsequent Windows attempt on `e6d808362` compiles and installs all five
codec libraries and confirms that the original and aliased x265 archives have
identical bytes. FFmpeg now opens the requested library, then fails on
`RegCloseKey`, `RegOpenKeyExA` and `RegQueryValueExA`. The pinned upstream x265
CMake logic omits `advapi32` from its package metadata. The attempt exits
numerically with status one before its deadline; its actual work tree and
independent preservation/process audits close without claiming a native pass.

The correction (`5df0bd496`, integrated in `8530d6c08`) adds a committed,
relocatable Windows x265 4.2 package-metadata adapter. An authenticated CMake copy
installs it after the retained library alias. Its private `advapi32` dependency
reaches FFmpeg's static probe, static `libavcodec.pc` and both downstream native
hosts through their existing package-metadata consumers. Raw sources, archive
pins, CRT, other codecs and POSIX recipes are unchanged. Four regressions fail
before the change; the initial 32 and committed 41 focused Motion cases pass on
Windows. Strict types, changed-file lint and maintained source audits pass.
The Framescaper test's input and phase expectations change inline without
growing its 598 lines; execution remains deferred to the full suite. The Frame
source inventory now has 84 files, and Motion's dependency pin is refreshed.
Fresh Linux controls, native builds, verification and packaging remain required.

The fresh Linux x64 build on `cb163a0ce` passes compilation, maintained result
verification, reference-decoder generation and all five native checks. Its
independent audit verifies unchanged source/npm/authenticated inputs and exact
generated output, with all 1,990 recorded identities and 12 groups/sessions
retired. The new receipt and 172-file reference prefix keep their actual
compilation identity. No historical compiled prefix is reused or retagged.
New packaging, installed workflows and the original maximum-index workload
remain required.

The complete `npm run check:static` gate also passes on `cb163a0ce` in 703.6
seconds within its unchanged 1,200-second bound. Full lint, types, architecture,
audits, documentation and the production build pass. The independent post
verifies 52,070 unchanged inputs and retirement of 92 recorded identities;
11,777 generated files retain their inventories. Startup tightening has no
changes, and the largest JavaScript chunk is 488,189 bytes. The 12 GiB heap is
confined to static compilation; application tests retain their default heap.
This does not establish complete Node, all-product browser or coverage acceptance.

The complete static gate subsequently passes on `3b2ae0f32` in 693.8 seconds.
Its independent audit verifies 52,070 unchanged inputs and retirement of 86
recorded identities. The generated inventory has 11,777 files, no startup-budget
changes and a largest JavaScript chunk of 488,189 bytes. A separate maintained
build creates all three browser sites and source maps on that source; its build,
preservation and process audits pass. No complete browser run on those sites is
claimed. These results are not retagged to the later native-recipe correction.

Five original historical `/tmp` workload directories are now absent, covering
590 files and 604,001,238 bytes. The five cached copies retain their own exact
body, metadata and membership witnesses and equivalent original-relative file
paths, lengths and hashes. The unavailable originals remain explicitly
unaccepted; their loss time and cause are unknown. The original strict baseline
capture remains failed. A separate loss-aware input baseline passes on
`3b2ae0f32`, admitting only those five specifically recorded absences and
retaining all available input and cached-copy checks. It qualifies inputs only,
not compilation, packaging or a release gate. New source requires a fresh baseline.

After the user's memory report, the previous kernel journal confirms one
distinct Node OOM event: PID 8039 had 46,568,652 KiB anonymous resident memory,
and the 12 GiB swap was exhausted. Repeated journal copies describe the same
source event. Neither its launch command nor a test leak is established; nearby
task-table PIDs do not prove ancestry. WSL subsequently restarted. Current
inspection finds about 4 GiB used and no surviving test workers. New large
workloads require per-run memory recording and an explicit abort guard.
A final extra read-only Windows receipt wrapper was lost across the restart; its numerical exit is unknown. The commit,
41-case test selection, types, lint and bundles had already closed and retained
their receipts before the restart.

The Linux polling guard subsequently passes six synthetic controls covering
normal termination, memory abort, exact process identity, unreadable accounting
and invalid settings. It records aggregate PSS plus swap with a 24 GiB abort
limit and an 8 GiB available-memory floor. The Windows guard shared functions
pass seven synthetic controls covering native process handles, working sets, private commit and failed cleanup. The
production guard polls every five seconds. At this preparation boundary it
remains disabled pending dispatch review. Neither polling guard is a kernel-enforced hard cap. Large workloads
are serialized; previous results are not retagged.

The sustained and maximum-workload harness repair on `27c5764f5` caps cumulative
process identity history at 4,096 plus the complete first admitted overflow batch of at
most 64. A bounded shared queue serializes discovery across samplers. An
admission failure retains cleanup identities and explicitly marks future births
unknown. Shutdown keeps the original ten-second escalation and adds a further
twenty-second bound for unresolved asynchronous cleanup, reporting unknown
physical closure rather than inventing an exit event. CDP close has its own
ten-second deadline and preserves failed-close outcomes, including after a late
physical close. Transport ownership is handed to the launcher before connection
setup can fail. Log and receipt filesystem finalization remains bounded by the
outer watchdog. All 60 focused fake controls, scoped TypeScript and changed-file
lint pass; these results establish neither an OOM cause nor a new native/browser gate.

The focused repair receipt is
`sustained-bounded-20261018-final-qualification.json`, SHA-256
`ebb8c248a1697f382db4bcc4d9926c5a2ae9f80fd2b5b096367fa55464368cd4`.
All 119 native source records retain their accepted bytes. All recorded check
identities are absent, and no owned services or handles remain. No manual
**Update AI assets** run is required by these harness and documentation changes.

The next Windows x64 native build installed all five external codecs, then failed
in FFmpeg's dependency scanner: the generated configuration retained the intended
two backslashes, while the awk invocation received one and rejected its syntax.
The build stayed below 1 GiB observed working set and did not reach its deadline.
Its failed result and independently checked input/process closure remain separate
from the WSL OOM investigation.

A tiny comparative control reproduced the inline-filter error with both Git Bash
executables. A file-backed filter produced the exact four expected dependency
files; all three intentional-failure controls stopped before their later marker.
The control owner reported a remaining authenticated descendant, terminated it
through its retained handle, and closed with no cleanup error. An independent
check found all ten observed process IDs absent. This is diagnostic evidence,
not a passed native build. The receipt is
`windows-x64-prerequisites-20261018/ffmpeg-dependency-canary-v13-20261018-v1/root-diagnostic-acceptance.v3.json`,
SHA-256 `4abe3b69db94c19a0e5284643c06e63a166bc77f6962de89c1b029b0d29a4eeb`.

The correction on `3883b077e` pins an awk source file, copies it into the Windows
FFmpeg build directory and selects it for all four dependency macros during
build and installation. The compiler flags, shell binding and POSIX commands
remain unchanged. The regression first failed for the absent preparation/filter;
the focused Linux selection then passed 36 cases with five declared Windows-only
skips. Changed-file lint, focused strict types, both source manifests and the
file-size gate pass. The maintained Windows x64 test then passed six cases with
one expected skip, using a byte-identical twelve-file NTFS projection of the
committed sources. Both native make phases exercised all four filters, the
original two-line COMPILE grouping, exact dependency/compiler markers and
confirmed failure propagation. The preceding UNC invocation failed before test
discovery and remains failed.

The Windows test's owner also remains failed: its authenticated pre-workload
`conhost.exe` persisted after the test finished. Exact-handle cleanup retired it
with no cleanup error, and an independent check found all ten recorded process
IDs absent. The observed test result qualifies this transport component only;
strict supervisor and complete native-build gates remain open. The receipt is
`windows-x64-prerequisites-20261018/ffmpeg-maintained-transport-3883-20261018-v2/root-observed-test-and-failed-owner-closure.json`,
SHA-256 `45f485a7ffe46fdfcbc1dfadebaf887c46313e78719c7f6959d7c1e94627f92f`.

A separate supervisor repair freezes exact PID and native creation-time pairs
before its first workload launch. Every later identity remains subject to strict
workload closure. After a zero worker exit, it explicitly retires remaining
sealed startup identities through their retained handles within the original
absolute deadline; failure cleanup and memory limits are unchanged. All 21
focused policy controls pass. A tiny native integration then passed: the worker
exited naturally with code zero, the sealed console received the recorded
termination request and exited with code 137, and all three recorded identities
were independently absent afterward. This qualifies the small supervision
mechanism, not a complete Windows native build. Earlier failed owners remain
failed. The independent retirement receipt is
`windows-x64-prerequisites-20261018/owner-startup-closure-20261018-v1/integration-external-retirement.json`,
SHA-256 `8345c759b9c0db7cbf0754bfbff1d8135ef6bb488c88ae3d66524a97aca99dd0`.

The prepared Windows qualification driver uses the original retained native
handle and 100 ns FILETIME identity. It replaces numeric PID tree termination
and unbounded waits with bounded waits within the original absolute deadline. Kernel
termination is required before reading the numeric exit, and a timeout remains
failed after forced exit 137. The outer owner also removes two redundant
unbounded waits after kernel termination. All 19 same-function fake controls
pass in 705 ms, and both fixture identities are independently absent. No memory
peak was logged. These controls do not qualify a complete native build. The
control receipt is
`windows-x64-prerequisites-20261018/next-win-x64-v14-ae0da538-20261018/stage-deadline-controls.passed-closed-review.json`,
SHA-256 `1c28aa54024eb5ca25de0018403b377c636a6487e7f6f714853976b94193205c`.

The fresh Linux native attempt on `83f68420c` failed its polling observer during
the host build. An authenticated compiler process had unreadable PSS and RSS
accounting, remained in state R, and its retained pidfd did not signal termination
within ten milliseconds. Its exact exit state at that boundary remains unknown.
The guard stopped the owned workload; sampled peak memory was 892,185 KiB and
available memory stayed above 35 GiB. No memory threshold or deadline was crossed.
The original build phase did not complete, and verification and reference phases
never started. The independent post retains three expected incomplete-closure
errors; all other input, history and process guards passed. Its 2,143 partial
files retain their own exact bytes, metadata and membership, and all 577 recorded
process identities are absent. Native acceptance remains false. The receipt is
`current-83f68420-native-after-watchdog-preparation-20261018/native-qualification.json`,
SHA-256 `46d3234360e05de8451615a54744f084f1380692e0e44de79b9b333a58821bef`.

The G2 guardian permits a 250 ms positive-exit observation wait on an already
retained pidfd only after unreadable owned-memory accounting and exact-identity
reauthentication. A real child delayed by 75 ms fails the original 10 ms control;
all 21 revised controls pass. Live or unknown unreadable memory still fails,
and ownership, memory thresholds and inner deadlines are unchanged. This
qualifies the observation policy only; it neither clears the failed native
attempt nor identifies an OOM cause. No **Update AI assets** run was performed.
The 16,933-byte qualification is
`wsl-oom-20261018/proc-memory-pidfd-exit-20261018-v2/qualification.json`,
SHA-256 `f103eb56b1e33f0117af798b5681afa79d811683f08d1883ef2094b3eed4e438`.

A fresh Linux x64 native run on clean source `ae0da5384` passes all three original
phases: native build with five native CTests, maintained result verification and
reference-decoder build. Its independent post passes all available source, npm,
tool, generated-artifact and historical-preservation checks within the explicit
five-missing-originals scope above. All 172 prefix files retain their exact
bytes and metadata; earlier failed builds remain failed. Peak owned PSS plus
swap was 907,241 KiB (about 886 MiB), with no swap use, resource abort or cleanup
signals. All 1,865 recorded identities, 79 groups and 15 sessions are absent;
the qualification writer and its parent also closed. This qualifies the Linux
native build and reference artifacts. Installed-app, complete Node/browser and
other-platform gates remain open, and the original Node OOM cause is unproven.
The qualification is
`current-ae0da538-native-after-watchdog-v2-preparation-20261018/native-qualification.json`,
SHA-256 `98a22c7bd193e73bbeb67e73ae698449c153ce1bf7d315b2ccce46c1408e6baf`.

Coverage assembly on `847c07eac` writes each normalized profile into staging
before reading the next profile or run, instead of retaining every parsed range
graph. Browser and packaged rereads retain exact byte fingerprints; local-assistance reads keep
their manifest digest checks. Per-run and per-family source-map placement and
late-error rejection are preserved. The production regression failed against the
original assembler when it opened the second run before writing the first.
All five focused regressions, changed-file lint, focused strict types and the
file-size gate pass. A frozen two-run synthetic comparison also preserves all
128 input files and produces identical paths, lengths and SHA-256 hashes for all
38 published capture files, including the complete index and family maps.
Failed production coverage remains opaque and unadmitted.
The largest individual profile, unique build metadata and later coverage-union
processing still need resource monitoring. This repair does not identify PID
8039's command or establish the cause of its OOM kill.

Coverage materialization on `80d614fe3` removes the remaining all-surfaces parsed
profile collection. It writes rebased profiles before parsing the next raw
profile and spools original observations by script equivalence group. The same
surface and topology validators retain observation order, map-only evidence,
invalid-surface exclusion and diagnostic behavior; c8 arguments and configuration
are unchanged. Every parsed raw buffer and staged observation is byte-bound;
publication also checks exact rebased-file membership. Genuine regressions
reproduce both the late first write and acceptance of an added staged JSON file.
All 11 focused Motion tests, strict types, changed-file lint and the size gate
pass. Earlier failed coverage remains opaque and unadmitted. The largest
individual profile or equivalence group, metadata, final union and c8 still
require memory monitoring; this is not a hard RSS bound or an OOM attribution.

Nightly test-child cleanup on `27f1f6118` fixes early rejection on log or child
errors and preserves the first failure through log finalization. A broken log
is unpiped and drained; the original child receives TERM and, if still running,
KILL after 250 milliseconds. The helper waits for child and writable closure
before settling. All ten focused Motion fake-process regressions, strict types,
changed-file lint and the size gate pass. The original early-rejection and
error-masking failures remain recorded. The first type check also exposed a test
annotation narrower than the existing signal result; its runtime-erased
correction passes the fresh strict check. These tests exercise the actual helper
with fake process and stream APIs. They do not qualify a real Playwright tree:
escaped descendants or inherited pipes can still require the outer supervisor.
No process-group or numeric PID tree-kill API was added.

Current retained receipts are relative to
`~/.cache/soundscaper/motionscaper-recovery-328cae02f-20261013/`:

| Evidence | Receipt |
| --- | --- |
| Preview progress repair | `preview-progress-final-validation-20261017/final-validation.json` |
| Failed complete Node run, `aeec86704665` | `current-aeec8670-node-final-20261017/qualification.json` |
| Lazy chunk correction | `preview-watchdog-chunk-owner-fix-20261018/qualification.json` |
| CI native tooling correction | `motion-native-ci-fix-20261018/qualification.json` |
| Nightly site correction | `nightly-motion-site-contract-fix-20261018/qualification.json` |
| Failed complete ordinary browser run and physical closure | `final-validation-aeec86704665-browser-20261017/ordinary-v2/actual/physical-closure.json` |
| Complete Motion browser outcomes | `final-validation-aeec86704665-browser-20261017/ordinary-v2/actual/motion-failure-classification-final.json` |
| Overwrite readiness scenarios | `original-capacity-diagnostic-f4b64a747-20261018/run/closed.json` |
| Tempo diagnostics plumbing | `tempo-input-recorder-plumbing-20261018/review.json` |
| Linux package, `6ab2c71d4` | `current-6ab2c71d-native-qualification/qualification.json` |
| Linux aggregate, `6ab2c71d4` | `current-6ab2c71d-native-qualification/installed-preparation/aggregate/qualification.json` |
| Native duration, `6ab2c71d4` | `current-6ab2c71d-native-qualification/installed-preparation/duration/qualification.json` |
| Maximum quality | `current-6ab2c71d-native-qualification/installed-preparation/maximum-v2/actuals/quality/qualification.json` |
| Maximum planes | `current-6ab2c71d-native-qualification/installed-preparation/maximum-v2/actuals/planes/qualification.json` |
| Maximum lights | `current-6ab2c71d-native-qualification/installed-preparation/maximum-v2/actuals/lights/qualification.json` |
| Failed maximum index and passed physical closure | `current-6ab2c71d-native-qualification/installed-preparation/maximum-v2/actuals/index/qualification.json` |
| Completed helper restoration | `current-6ab2c71d-native-qualification/sandbox-return/qualification.json` |
| Complete static gate, `0241c6e1c` | `current-final-source-static-0241c6e1c-20261018/qualification.json` |
| Complete static gate, `feabe1b3c` | `current-final-source-static-canon-preparation-20261018/execution-summary.json` |
| Export audio retention correction | `motion-audio-block-retention-6463b7e69-20261018/focused-validation.json` |
| Full lint on the correction's final file bodies | `motion-audio-block-retention-6463b7e69-20261018/full-lint-validation.json` |
| Failed private-project package and passed physical audit | `current-6463b7e69-native-preparation/owner-failed-qualification.json` |
| First-paint readiness correction | `first-paint-readiness-20261018/final-validation.json` |
| Canvas painted-frame readiness correction | `canvas-readiness-f751-20261018/qualification.json` |
| Audio resume recovery and synchronized start | `motion-audio-recovery-ac8499d-20261018/qualification.json` |
| Prompt raster runtime consumer cancellation | `raster-runtime-cancel-20261018/final-validation.json` |
| Merged first-paint auxiliary retirement | `first-paint-readiness-20261018/retired-auxiliary/retirement.json` |
| Windows NASM installation/PATH corrections | `windows-x64-prerequisites-20261018/nasm-ci-path-fix-commit-receipt.json` |
| Windows libvpx recipe correction | `windows-x64-prerequisites-20261018/libvpx-msvc-fix-commit-receipt.json` |
| Windows libvpx path correction | `windows-x64-prerequisites-20261018/libvpx-native-path-fix-commit-receipt.json` |
| Fourth failed Windows build and physical closure | `windows-x64-prerequisites-20261018/native-build-native-path-v7-failed-closed-review.json` |
| Bounded native Make shell control | `windows-x64-prerequisites-20261018/native-make-shell-canary-v1-closed-review.json` |
| Windows libvpx shell correction | `windows-x64-prerequisites-20261018/libvpx-native-shell-fix-commit-receipt.json` |
| Fifth failed Windows build and physical closure | `windows-x64-prerequisites-20261018/native-build-native-shell-v8-failed-closed-review.json` |
| Verified Windows libvpx source staging | `windows-x64-prerequisites-20261018/libvpx-source-staging-fix-commit-receipt.json` |
| Failed real long-generator control and physical closure | `windows-x64-prerequisites-20261018/native-libvpx-long-generator-canary-v1-failed-closed-review.json` |
| Nested Windows libvpx source paths | `windows-x64-prerequisites-20261018/libvpx-nested-src-fix-commit-receipt.json` |
| Passed grouped long-generator and failure controls | `windows-x64-prerequisites-20261018/native-libvpx-long-generator-canary-nested-v3.passed-closed-review.json` |
| Windows FFmpeg source/install/shell path correction | `windows-x64-prerequisites-20261018/ffmpeg-native-path-fix-commit-receipt.json` |
| Ordinary Motion browser component, `7b804853d` | `combined-motion-browser-7b804853d-20261018/final-validation.json` |
| Linked-editor Motion component, 13 Chromium cases, `7b804853d` | `combined-motion-links-7b804853d-20261018/final-validation.json` |
| Timed-out Windows codec build and physical closure | `windows-x64-prerequisites-20261018/native-build-native-codec-path-v9.timed-out-closed-review.json` |
| Failed Windows x265 link and corrected physical audit | `windows-x64-prerequisites-20261018/native-build-native-codec-path-v10.failed-closed-review-v3.json` |
| Windows x265 library normalization | `windows-x64-prerequisites-20261018/x265-normalization-commit-receipt.json` |
| Integrated Linux Motion-only normalization controls | `windows-x64-prerequisites-20261018/root-integrated-x265-linux-motion.receipt.json` |
| Fresh Linux native build/verifier/reference, `cb163a0ce` | `current-next-native-preparation-20261018/bound-cb163a0ce/native-qualification.json` |
| Complete static gate, `cb163a0ce` | `current-cb163a0ce-static-canon-20261018/qualification.json` |
| Failed Windows Registry dependency link and physical closure | `windows-x64-prerequisites-20261018/native-build-native-codec-path-v11.failed-closed-review.json` |
| Windows x265 static package-metadata correction | `windows-x64-prerequisites-20261018/x265-pkg-config-commit-receipt.json` |
| Complete static gate, `3b2ae0f32` | `current-3b2ae0f32-static-canon-20261018/qualification.json` |
| Three-product browser build and preservation only, `3b2ae0f32` | `final-full-browser-3b2ae0f32-20261018/build-qualification.json` |
| Historical original-file loss and retained cached copies | `current-x265-native-preparation-20261018/bound-3b2ae0f3/historical-loss-qualification.json` |
| Loss-aware input baseline only, `3b2ae0f32` | `current-x265-native-preparation-20261018/loss-aware-3b2ae0f3/baseline-qualification.json` |

These results retain their exact source attribution. The subsequent test and
documentation commits do not retag frozen executions. Fresh complete Node,
all-product browser and accepted combined coverage gates remain required on the final
integrated source. Installed After Effects, other desktop targets/hardware,
signing, installation, updating and publication remain unqualified. No installed
AE test environment is available. The Motion changes described here do not
change the assistance runtime closure and require no manual **Update AI assets**
run; independently merged GPU runtime changes retain their own obligations.

### Previous integration baseline

Source `baaeb3816` passed the complete static gate, all five Node partitions
(27,462 passes, 17 declared skips, including all 1,227 Motion cases), linked39,
dual9 and the original native duration workload. Its ordinary browser gate
failed: 7,268 passes, 308 declared skips and eight failures. Final input
verification also refused a canonical revision change from `52ae9c43c` to
`23762c9e1`; the failure and missing post-input receipt remain preserved. Its
raw browser coverage is excluded. The five admitted Node partitions retain
their historical source and do not establish a current combined coverage union.

All eight focused browser diagnostics subsequently passed on `9323a1eda` with
unchanged limits. One duplicate clip-locator defect was corrected; the other
seven original causes remained unknown. Historical maximum quality passed,
planes failed near the 30-second worker deadline, and lights/index did not run.
These results do not qualify the later worker repair. Earlier source-specific
results and their limitations remain recorded below.

The affected native Frame successor link/delivery regression passed
on `48a90f028` with exact PCM/timestamps and the original picture/alpha limits.
A later documentation-only correction retains the existing lowercase
"installed After Effects" caveat expected by the capability-register test;
the unmodified four-case regression passes after that correction. The partial
source48 static and Node runs were cancelled before completion and remain
unaccepted; their coverage is not used.

Application source `70a02ba9e0dd01d34f3b79eb9a7f259d2197e7d2`, tree
`d17908da24d1b8fcf994866e0cdde95586bbf129`, passed full Node/static and the
fixed Linux installed aggregate, native duration and four maximum profiles.
One controlled Chromium duration run passed. Its complete three-suite browser
gate failed with eight failures; historical failures remain failed. Accepted
coverage and external release gates remain open. No milestone is complete.

### Earlier integration notes

The following implementation notes retain their original source-specific scope.
Earlier application source `8b2325853` includes native-selection draft ownership,
the reviewed native shutdown repair,
paired-download synchronization, saved-kind/cross-consumer contract tests and
deferred panel focus ownership. M06 also includes graph/path keyboard activation
and stronger animated multilingual-title delivery checks. M08 now retains
expression ownership and source spans at final export; M09 has an animated-camera
reference with independent projection and pixel controls.
M10 now retains captured native inputs during compatible saved updates and
retains failed physical cleanup handles for retry.
Two browser MP4 checks now measure authored sRGB fidelity from the declared
file colors, while retaining the original Canvas presentation measurements and
same-plane controls at unchanged color limits.
The nightly test payload now includes the concurrent-export fixture, repairing
the three reproduced staging failures without changing application code.
The mixed-preview test now samples the transient playback frame every 50 ms;
its original six workflows pass across all three engines.
The sustained sampler now retains a terminal rejected memory row before raising
the original limit error; the fix changes no memory limit or application code.
Preview audio now opens its default output on Play, preserving visual-only
preview without an eager AudioContext. The separate native maximum-workload
fixtures, oracles and bounded driver are integrated. Their functional passes
and memory refusals remain separate below. Optional backing/embedder and Linux
private/shared accounting is retained from measurements already collected;
missing optional data is explicit, never inferred as zero. One fresh unchanged
browser-duration run passed both controlled durations on that source. Earlier
failures remain recorded, without an inferred allocation cause. Combined gates
remain open. The shared Amplify field also reserves native select-all intent
before pending automatic headroom can replace the selection. Its real-controller
regression and untouched-field control pass across all three browser engines.
The failed ordinary browser capture used frozen source
`328cae02fb961d87524a6bcb37c54800b3ae7026`. Its former
`feat/motionscaper-final-validation` checkout and merged branch were removed
after source and artifact preservation. This status records fresh validation on
2026-10-15. The complete ordinary browser run on source
`322c8a6b1c48a1efd0f4436d1f91b42323b0cf3c` closed failed with 7,228 passes,
48 failures and 287 declared skips. Its Motion-named subset passed 436 cases
with two declared skips. The older `3e8b3e9420aeda3353158ab9400461c5af1a2980`
run remains failed with 7,215 passes, 40 failures and 287 declared skips. Each result qualifies only its stated
source and workload; none marks a milestone complete or certifies a release.

## Evidence boundary

The environment reboot removed `/tmp` proposals, execution logs, receipts and
preservation/reference artifacts stored there. The old reports below remain
historical. Fresh sites, native helpers, reference decoders and Linux packages
were built and verified separately against source 328. Their new receipts do
not reconstruct the lost runs. Source and committed configuration alone prove
implementation, not execution or compatibility.

Fresh results below have terminal process results and retained evidence under
`~/.cache/soundscaper/motionscaper-recovery-328cae02f-20261013/` on the validation
host. The original ordinary browser invocation is closed and failed; the fresh
complete run and subsequent focused results retain their own sources. Changed source will need the
applicable gates again. Do not infer
success from a progress marker, an earlier source's result or generated files.

## Implementation and acceptance are separate

The [owning implementation order](motionscaper-implementation-order.md) makes
all twelve packages required for first release. The latest read-only scope audit
maps 68 requirement groups to their owning sources. It found the editor catalog
admission omission and separate EN/DE-only bridge locale path (both now fixed),
and missing generated Motion translations. Both seams and all 26 scoped
translations are integrated; fresh browser proof is open. This is not an
exhaustive correctness proof.
The original completion gates remain unchanged.

| Package | Implemented local paths | Acceptance still needed |
| --- | --- | --- |
| M01 | Own browser/desktop bootstrap, storage/locks/origin, release identity, routes, offline assets, locale/help and test ownership. | Current shells and existing products, exact isolation/resource closures and supported installed targets. |
| M02 | Typed family-v1 `.mscape`, validation/history/leases, durable asset closure, foreign/future custody; explicit Frame 1.1 family-v2 migration with exact originals. | Current malformed/archive/retention/interruption/ownership workflows across admitted hosts. |
| M03 | Shared rational evaluator, parenting/precomp/audio/remap, typed curves and consumption ledger used by preview/export/linked sources. | Current nested/mixed-rate/seek/cycle/timing/history equality across consumers. |
| M04 | Pinned lazy CanvasKit, retained fonts, paragraph/vector rendering, linear SDR CPU/WebGL compositing. | Current multilingual/geometry/color/alpha/offline and equal-quality reference results. |
| M05 | Persistent preview worker/host adapter, bounded queues, MP4/WebM/PNG, native ProRes/PCM, retained cleanup and duration harnesses. | Four original Linux x64 maxima pass on `0282106d9`; complete current browser and remaining duration/host qualification stay separate. |
| M06 | Opt-in timeline, canvas, property/value/speed/path/operator/text-animation controls, parenting/nesting/work areas/clipboard. | Complete title/shape authoring, Save/reopen/export, Undo, focus/keyboard/accessibility and shaping workflows. |
| M07 | Masks/feather/mattes/blends/adjustments/effects, point/planar/stabilization/corner pin/chroma key and manual corrections. | Current tracked/keyed/masked pixels and history, stale-analysis/cycle/unavailable-effect behavior. |
| M08 | Closed deterministic expression AST, stable references, procedural/audio queries, diagnostics and baking. | Current seek/order/cycle/budget/cancellation/audio/bake evidence. |
| M09 | Perspective/orthographic scene authoring, lights/materials/shadows, translucent depth planes, deterministic lens/shutter sampling. | Linux maximum-quality, 64-plane, 32-light and index references pass on `0282106d9`; complete browser and other hardware/platform qualification remain open. |
| M10 | Explicit saved-revision transfer, Frame successor connection/conform/Undo/Resume, native watcher, retained offline preview/finish/export. | Current full link/dual-origin/offline/atomic/concurrent export and actual platform-isolation evidence. |
| M11 | Readable installed-host scripts, reviewed editable subset, sampled/rendered alternatives, immutable original/report/media custody. | Actual installed AE export/reimport, reference frames/subframes and tested host-version matrix; environment unavailable. |
| M12 | Own candidate/stable packaging, source-bound web build/deployment, signing/updater configuration, associations, handbook/copy and capability register. | Complete Node/browser build pass on `bc586f975`; static, Linux unpacked packages/maxima and Windows unsigned software-GPU smoke pass on `0282106d9`. Complete browser/union coverage, remaining target/install/sign/update and real-AE gates remain open. Publication is a separate owner action. |

File provides New Composition, Open/Save/Save Copy, media import, compositions,
After Effects Bridge, Send Composition to Framescaper, Render and Render Queue.
View opens the workspace, canvas, preview and timeline; Layer opens properties,
paths, operators, appearance, compositing, tracking, expressions and scene tools.
Help opens the own handbook/tutorials and the desktop's manual own-tag update
check. These are implemented opt-in surfaces, not missing menu placeholders.

Source authorities include `src/common/editor/ui/motionscaper/shell-menu.ts`,
`MotionscaperDocumentRuntime.tsx`, the Motion project/evaluator/renderer owners,
`src/framescaper/editor-composition-link-*`, and the dedicated desktop IPC.
The [release preparation](../operations/motionscaper-release.md) also exists:
Motion Pages tables, own stable workflow and exact source/artifact deployment
checks are implemented. The register remains on the candidate channel. No tag,
register activation, hosted deployment, dispatch or publication was performed
by this recovery.

## Earlier integrated validation (source52/source70)

Source `52ae9c43c` passed the complete maintained static gate, including all eight
lint shards, strict types, architecture, audits, documentation and production
build. The largest JavaScript chunk remains 486,512 bytes, within the unchanged
500,000-byte ceiling. Startup tightening changed no budget. All five exhaustive
Node partitions passed with 27,476 tests: 27,459 passes and 17 declared skips.
All 1,224 Motion cases passed. These are source52 component results; they do not
qualify later test and harness changes or accept their coverage.

The following corrections are committed after source52. Their retained receipts
identify the exact tested source or temporary overlay and application build;
the table does not relabel them as complete combined-source qualification.

| Commit | Correction | Focused evidence and remaining limit |
| --- | --- | --- |
| `5d7734894` | Wait for spectral brush actionability before the initial drag. | Six controlled browser cases pass with the original drag and history oracles. |
| `c5fe82a72` | Reserve native select-all before replacing Contrast amplification. | Four controlled contexts pass; the original failed input chronology remains retained. |
| `dc29f22da` | Count actual native seek assignments when checking retime cache reuse. | Four Firefox cases pass, including both frame requests and delegated seek behavior. |
| `15391ed32` | Measure the first nontransparent EQ pixel. | The old probe fails a real-canvas control; the corrected control passes all engines. The nine-case run remains failed: seven passes and two Firefox signal failures before pixel sampling. |
| `d89034020` | Admit the captured terminal process record with unavailable group/session IDs. | The real-record regression fails before the fix; all 39 Motion process and cleanup controls pass afterward. Live, malformed and mixed negative IDs remain refused. |
| `9adc52dbb` | Wait for the selected translation draft before replacing and saving it. | Four WebKit import/save/release/export checks pass. |
| `f7bde573c` | Replace tempo with native keyboard input and verify the draft before blur. | Three previously failing workflows and a podcast control pass in WebKit, including numerical results, persistence and reload. |

The process correction changes no ownership, signalling, output, cleanup or
deadline limits. None of these corrections changes application rendering code,
assertion thresholds or declared test timeouts. Historical failures remain
failed; passing focused cases do not prove an exclusive historical cause.
Complete browser qualification, the accepted coverage union and final ratchets
remain open. The next complete browser run will use the repository's CI engine
limits: two Chromium workers and one each for Firefox and WebKit, with four
workers total, zero retries and the complete three-engine selector. The existing
four-worker run retains its original execution settings and outcome.

The preceding application and browser probe repairs are committed as:

- `db3d017fe`: prepare buffered/live sources before the shared playback start,
  then allow one rebase of an expired, wholly unstarted eligible window. The
  original strict per-source refusal and recorder/message-bound ownership
  remain enforced. Four meaningful pre-fix regression failures are retained;
  all eight new controls and 49 existing ownership/timing controls pass after
  the fix, with strict types, changed lint and size checks.
- `98366245c`: point each product handbook sidebar at its physical product
  source directory. Motion58 and Frame87 page/navigation checks pass, alongside
  the original Sound32 regression cases. The normal complete Motion Pages build
  passes local app/docs/staging/asset checks and fails the final live predecessor
  preflight because no deployment answers `https://motionscaper.org`. No bypass
  or deployment was performed.
- `7f148d5b3`: use stable source IDs for take-flatten peak comparisons and add
  real same-name WAV imports with independently authored amplitudes. The old
  name probe fails that control by 0.499969482421875; both corrected cases pass
  in Chromium, Firefox and WebKit. Original width, precision, frame-count and
  history assertions remain unchanged. This proves the probe defect, not the
  exclusive cause of the historical flatten failure.
- `fc38539a6`: normalize zero seconds in native `datetime-local` test input.
  Firefox reproduces the malformed whole-minute value before normalization;
  the deterministic boundary and original real timed-recording workflow pass
  in all three engines. Application behavior and timeouts are unchanged.

The three source70 UI failures remain unresolved. One passive four-case
Chromium diagnostic passed with one worker; a separate run passed with the
original four-worker/fully-parallel setting. Brush input reached enabled,
selected surfaces with normal pointer capture; focused Clip Properties Enter
opened its dialog. These are non-reproductions, not repairs. One menu event
ring evicted early entries, and uncaught page errors were not independently
collected. Temporary hooks are not part of the integrated source.

On source70, all five Node partitions passed: 27,468 total, 27,451 passed,
17 declared skips and zero failures; all 1,224 Motion cases passed. Full static
passed with unchanged startup/chunk limits (largest Sound locale chunk
486,512 bytes). The fixed Linux x64 software aggregate passed all five
workflows. Original native 300/1,200-frame duration and maximum cases passed:
64×64 shutter/lens with shadows, 64 planes/65-plane refusal, 32 lights and
32,768 frames/32,769-frame refusal with cancellation/retry. Index PSS growth
was 63,667,200 bytes against 67,108,864. The original metadata refusal remains
preserved beside the narrowly accepted reference-decoder ctime audit;
combined input/process/output closure passed.

Controlled Chromium 300/1,200-frame preview, physical OPFS PNG/VP9 WebM,
lossy Opus, cancellation/retry and all 546 memory rows passed unchanged limits.
This does not qualify exact PCM or the OS picker. Source70's Motion58 sidebar
failure remains failed beside the isolated repair's evidence.

The ordinary invocation completed all 7,578 cases with 7,283 passes,
287 declared skips and eight failures: five Chromium, one Firefox and two
WebKit. Linked39 and dual9 passed all cases separately. The full three-suite
outcome is 7,331 passes, 287 skips and eight failures from 7,626 cases.
All 442 executed Motion-named ordinary cases passed, with two declared skips;
this does not qualify the whole gate. The original ordinary post freeze also
failed on Firefox's empty `.parentlock` timestamps. A complete supplementary
read-only comparison found only that pair changed across all 66,042 original
records; all bytes and remaining fields matched. It does not promote either
original failure. Linked/dual checks used narrow future-only accounting for
that exact empty lock; all remaining inputs stayed strict. All producers and
post audits are closed, and raw coverage stays opaque and unadmitted.

The changed scheduler requires fresh complete gates and a rebuilt native Frame
successor delivery workflow. Independent Motion-only duration/maximum results
retain source70 component attribution; they are not relabeled as whole-package
qualification for the later source. Coverage union and monotone ratchets remain
open. Installed AE, other hardware/OS/architectures, signing, installation,
update and publication remain unqualified.

Current receipts below are relative to the retained recovery root:
`~/.cache/soundscaper/motionscaper-recovery-328cae02f-20261013/`.

| Evidence | Receipt |
| --- | --- |
| Source52 complete Node/static | `current-52ae9c43c-node/qualification.json`; `current-52ae9c43c-wt7-static/qualification.json` |
| EQ pixel control and failed nine-case run | `eq-spectrum-raster-oracle-c5fe82a72-20261016/baseline-run/qualification.json`; `eq-spectrum-raster-oracle-c5fe82a72-20261016/candidate-v2/qualification.json` |
| Terminal process correction | `terminal-process-state-repair-20261016/qualification.json` |
| Translation draft and tempo corrections | `community-import-input-c5fe82a72-20261016/runner-h/qualification.json`; `tempo-native-input-c5fe82a72-20261016/runner-c/qualification.json` |
| Complete Node/static | `current-70a02ba9e-node-final/qualification.json`; `current-70a02ba9e-static/qualification.json` |
| Linux workflows | `current-70a02ba9e-native-qualification/aggregate-audit/qualified-after-reference-ctime-audit.json` |
| Native duration/maxima | `current-70a02ba9e-sustained-native/qualification.json`; `current-70a02ba9e-native-maximum-preparation/final-native-handoff.json` |
| Handbook failure/repair | `current-70a02ba9e-handbook-preparation/qualification.json`; `handbook-sidebar-repair-70a02ba9e-20261016/qualification.json` |
| Chromium duration | `current-70a02ba9e-sustained-browser-unready/qualification.json` |
| Failed ordinary browser | `current-motion-browser-final-preparation-20261015/full-actual-70a02ba9e-unready/ordinary-full/qualification.json` |
| Linked/dual browsers | `current-motion-browser-final-preparation-20261015/follow-on-parentlock-70a02ba9e-unready/linked/qualification.json`; `current-motion-browser-final-preparation-20261015/dual-parentlock-70a02ba9e-v2-unready/dual-origin/qualification.json` |
| Affected native Successor regression | `successor-playback-repair-48a90f028-20261016/qualification.json` |
| Playback repair | `playback-repair-70a02ba9e-20261016/qualification.json` |
| Browser probe repairs | `browser-probe-repairs-70a02ba9e-20261016/qualification.json` |
| UI diagnostics | `ui-input-diagnostic-70a02ba9e-20261016/preparation-wt7/qualification.json`; `ui-input-diagnostic-70a02ba9e-20261016/workers4/qualification.json` |

No manual **Update AI assets** run is required. No tag, signing, workflow
dispatch, hosted deployment or publication has been performed.

### Earlier source-attributed validation

The chronology below preserves original failures and the pending prerequisites
at each recorded boundary. Later passes do not promote those failures.

The complete five-partition Node gate on `361418fee` closed with 27,468 tests:
27,406 passed, 45 failed, 17 skipped and none cancelled. All 1,224 Motion cases
passed. Forty-four failures reached missing XML/media readers or dependency
path prerequisites; the remaining failure caught the Hindi catalog's size.
The complete static gate passed lint, types, architecture, audits and handbook
checks/build, then refused seven chunks above 500,000 bytes: hi 620,842,
el 569,154, hy 560,418, ru 556,845, uk 550,597, fa 511,766 and ar 501,085.
Both outcome-agnostic closure audits passed. These full gates remain failed;
their raw coverage remains opaque and unadmitted.

Repair `802026569` keeps each committed catalog and the generated loader index
intact while giving its core and Motion entries separate lazy build owners.
The production-bundler regression round-trips all 59 complete catalogs,
including their provenance, and checks every emitted chunk below 490,000 bytes.
It also verifies that catalog data stays outside the initial static graph and
that locale fragments do not enlarge the boot preload list. All three controls
and changed-file lint pass. The first application build caught a 657-byte
startup-budget excess from static fragment imports; that failure is retained.
Awaiting fragment imports inside the selected locale fixes that regression.
The subsequent normal Soundscaper build passes all presentation, asset and
chunk guards: 567 JavaScript chunks, largest 486,512 bytes. Its initial graph
has six requests, 253,662 raw bytes and 69,341 Brotli bytes; the normal startup
ratchet found no ceiling to tighten. This validates the repair, not the full
Node/static/browser/native release gates. The test worktree still needs its
physical dependency directory and authenticated reference readers before the
next full Node run.

The failed Node receipt is `current-361418fee-node-final/qualification.json`,
SHA-256 `3a70a35ee275be7e08ee30cc8d913e6e7c3ddee36ca0c73cf3cf47d644c96b1c`.
The failed static receipt is `current-361418fee-static/qualification.json`,
SHA-256 `c92bce18f7bc891a9d5762eb4ee6fa843cdc821cd8f377e8bebe203e18d2496d`.

The latest locale/morph/codec additions are separate from the frozen `c6033a71a`
full-gate evidence. The catalog fix retained its two failing pre-fix cases and
passed 18 focused controls, strict application/test types, changed lint and size.
After integration, all four catalog tests pass against the normal loader and
resolver. The bridge accepts full supported catalog tags and uses the normal
async catalog loader; late copy changes do not recreate its connection. All 13
combined catalog/locale/lifetime controls pass, and a normal TSX-loader probe
resolves the nine actual French bridge labels. Its new cross-origin browser
case has static checks only; runtime proof remains pending.

The integrated generated languages are ar, cs, el, es, fa, fi, fr, gl, he, hi,
hy, id, it, ja, ko, nl, pl, pt-BR, pt-PT, ro, ru, tr, uk, vi, zh-CN and zh-TW.
They contain 19,032 new Motion/bridge entries and 52 Motion handbook pages. Every locale's
41 exact packet answers passed the normal writer with no skipped keys, strict
catalog checks passed, and both new pages validate current. Existing human,
Audacity and machine entries, unrelated catalogs and the loader index were
preserved. Root independently matched all 78 final files against the writer's
handoff and checked all 104,494 prior entries against the original source.
The frozen handoff is `motionscaper-translation-authoring-14adf0eeb-20261015/translation-final-handoff.json`,
SHA-256 `ba3fbc766328070a1a98f6d6a31e358f128c8ff7cf25766144006ad05ec722b0`.
This qualifies the scoped Motion content, not all pre-existing handbook translations.
A separate whole-French strict handbook check reported nine stale
pages and navigation at 31/33 current; it remains failed and is not a claim
against the two new Motion pages. The morph case has browser types/lint/size
only, and the codec evidence change has browser types/lint only; both await the
fresh browser run. The old browser preparation remains unarmed. Its canonical
source expectation was released before the later application changes; the
original `c6033a71a` sites, maps, readers and source remain held unchanged.

The frozen `c6033a71a` Linux software native aggregate receipt is
`current-c6033a71a-native-qualification-v2/aggregate-audit/qualification.json`,
SHA-256 `5f535ea28d4c878a759a1f0c145c63fbafdf842ac0eb2bb0d350b7cc2f6809ca`.
The later duration receipt is `current-c6033a71a-sustained-native/qualification.json`,
SHA-256 `2b79175e7d420672cd7f3d9dbe45040053d894aaadc58cfb146018a03b9d749b`.
Its independent existing-output audit recomputed 467 memory rows, 75 genuine
encoder rows and every decoded PCM/PTS oracle for the six MOVs, with changing
authored pictures at three positions per output. Peak application RSS/PSS was
1,000,865,792/622,234,624 bytes; original absolute, tail, cadence and cleanup
limits passed. All 54 recorded workload identities and 22 sessions were absent.
These receipts qualify only application `c6033a71a`; the earlier failed runs,
aggregate observer refusal and other-host/maximum/AE limits remain separate.

All twelve packages remain **In progress**. The complete implementation and a
passing focused workflow are distinct from the required combined acceptance.
These newer results retain their own source identities; none changes the failed
source-328 ledger below into a pass.

| Gate and source | Latest terminal result |
| --- | --- |
| Native Amplify selection, `2934d6a70`, integrated as `8b2325853` | A real-controller case reproduced native number selection without keydown being replaced by late automatic headroom. Native selection now reserves the existing Amplify draft. All 22 directly relevant unit controls and nine component cases passed across Chromium, Firefox and WebKit, retaining untouched automatic headroom, keyboard selection and exact replacement with six. Original 30-second case/5-second assertion bounds and zero retries remain. Focused strict types, changed lint and size passed; all 37 recorded identities/four sessions were absent and input/link guards passed. The earlier controlled failure remains failed; the historical guide failure cause remains unproven. These focused results postdate the `db4e586d0` complete gates and do not retag them. |
| Complete static gate, `c6033a71a` | Passed the unchanged complete `npm run check:static`, including full lint, all types, architecture, audits, documentation/handbook and production build, within the original 1,200-second deadline and static-only 12 GiB heap. Both post-audits passed; prior db4 source/output bodies remain preserved. All 89 sampled PID/start identities and root/outer sessions were absent, with inaccessible observations explicit. Source/package/owned-copy guards passed and 11,444 generated files totaling 633,273,708 bytes were retained. Startup tightening changed no budget. Browser, native application and coverage acceptance remain separate. |
| Complete static gate, `db4e586d0` | Passed the unchanged complete `npm run check:static`: full lint, all source/product/test/browser/tooling types, architecture, audits, documentation and production build, within the original 1,200-second deadline and static-only 12 GiB heap. The isolated worktree uses a verified real copy of the unchanged five-file `@ffmpeg/core` package; no audit or budget was weakened. All 31,992 canonical package bodies/metadata, 85 symlink targets and five owned core files were unchanged. All 90 sampled PID/start identities and root/outer sessions were absent; inaccessible process observations remain explicit. Startup tightening changed no budget. This does not replace the earlier failed static attempt or qualify the complete Node, browser, native-host matrix or coverage gates. |
| All five exhaustive Node partitions, `c6033a71a` | Passed: 27,456 tests, 27,442 passed, zero failures/cancellations and 14 declared skips; all 1,212 Motion cases passed. The unchanged maintained partitions used their original 1,200-second deadlines, native prerequisites and default runtime heap, without retries. All 51,416 declared input records were stable, and all 5,345 recorded PID/start identities and five authenticated root sessions were absent; sampled-census limitations remain explicit. Two identical inventories retained 5,275 raw profiles totaling 13,270,822,837 bytes, unparsed and unadmitted as coverage. Earlier passing and failed runs retain their source attribution; this is not browser, installed native application or release qualification. |
| Native staging/package preparation, `c6033a71a` | All six maintained phases passed: helper reuse verification, Motion stage/package, successor stage/package and resource verification. The gate retained 1,946 generated files; all 17 recorded identities and six owned command sessions were absent. Source, npm, prefix and old-package guards passed. At this preparation boundary, new packaged sandbox helpers were ordinary user-owned 0755 copies. No native/reference compilation, decoder or application workflow ran; current installed aggregate, controlled-duration, maximum and external host qualification remain open. |
| All five exhaustive Node partitions, `db4e586d0` | Passed: 27,448 tests, 27,434 passed, zero failures/cancellations and 14 declared skips; all 1,212 Motion cases passed. The unchanged maintained partitions used their original deadlines, native prerequisites and default runtime heap, without retries. All 51,414 declared input records were stable, and all 5,335 recorded PID/start identities and five authenticated root sessions were absent; sampled-census limitations remain explicit. Two identical inventories retained 5,272 raw profiles totaling 13,268,876,015 bytes, unparsed and unadmitted as coverage. The earlier failed `2f1ffce7f` run remains unchanged; this is not browser, native application or release qualification. |
| Complete static attempt, `2f1ffce7f` | Closed failed at the FFmpeg runtime audit: the isolated worktree's `node_modules/@ffmpeg/core` package-directory symlink was refused while reading its `package.json` by the existing regular-file guard. Full lint, source/product/test/browser/tooling types and architecture passed. Remaining audits, documentation checks and the build were not reached. All 56 recorded/session identities closed; canonical package bytes/metadata and own aliases were unchanged. This isolated dependency-topology refusal does not establish an application defect or a complete static pass. |
| All five exhaustive Node partitions, `2f1ffce7f` | Closed failed: 27,448 tests, 27,433 passed, one failed and 14 declared skips. Common-2's sole failure is nightly-payload import closure for the native range-touch owner; the other four partitions and all 1,212 Motion cases passed. Post-audit verified 51,414 source/installed inputs, empty recorded/root sessions and 5,278 stable raw profiles totaling 13,271,131,217 bytes. Coverage remains unparsed and unadmitted; no Node heap override or retry was used. |
| Nightly range-touch staging repair, `2f4eb36b7`, integrated as `59c4045b1` | Adds the existing native range-touch owner to the nightly payload and its staging fixture. All 19 directly relevant staging/import/refusal checks passed without skips, along with changed lint, size and diff checks. Application, dependency and assistance-runtime bytes are unchanged. This focused pass does not replace the failed complete Node run; the later integrated `db4e586d0` gate retains its own result. |
| Native chooser observations, `d7dc53145`, integrated as `60afc104a` | Twenty new offline controls and seven existing chooser controls pass. The maintained driver now emits at most four passive records/8 KiB with actual display identifier, target/candidate window identities, owner PID, focus and phase timestamps. Passive X11 errors are isolated by display identity. Removing only observation additions restores the original driver AST; actions, deadlines and pass/fail predicates stay unchanged. Tooling/focused test types, changed lint and size pass. No live application, chooser, compiler or decoder replay occurred; the failed native invocation remains failed and its cause remains unknown. |
| Vanished-process liveness reads, `edfe0ae3f`, integrated as `2960d5449` | Two deterministic tests reproduced treating a vanished `/proc` ESRCH read as a cleanup error. The liveness check now treats only ENOENT/ESRCH reads as absence, matching the existing process samplers. All 29 shutdown/observation controls, strict tooling/full test types, changed lint and size pass. Recycled identities remain excluded; malformed/permission/unknown read errors and signalling errors remain failures. All 18 recorded identities/owners were absent. No application replay, chooser repair or retrospective native-duration pass is claimed. |
| Shared Amplify draft reservation, `3330272ef`, integrated as `b91204a52` | A real-controller Firefox case reproduced late headroom replacing a native select-all draft before insertion. Five production lines reserve existing draft ownership on unmodified Ctrl/Cmd+A. All 11 Amplify controls and three existing blur/keyboard controls pass; the untouched-field and native-select-all cases pass in Chromium, Firefox and WebKit with original bounds and no retries. Strict types, changed lint, size, normal hidden-map build and startup checks pass. All 83 recorded identities were absent; source, browser and installed-package guards passed. Earlier build-output-admission, lint-owner deadline and default-heap compiler failures remain separately retained. This establishes the reproduced keyboard case, not the cause or repair of the historical full-suite Amplify failure. |
| Complete static gate, `bbb172047` | Passed the maintained `npm run check:static`: full lint, all source/test/tooling types, architecture/size, audits, handbook checks/build and production build. The 12 GiB heap was confined to this static command. All 89 observed PID/start identities and the root session were absent; source remained clean. Startup tightening found no ceiling to lower. Source changes from `036899f59` are three documentation files. This is not a full Node, browser, native-host matrix or coverage pass; existing pending native interoperability audit statuses retain their meaning. |
| Current Motion tests and static components, `036899f59` | Passed all 1,179 Motion cases in 271 files, with no failures, skips or test heap override. Full repository lint passed all 12,177 files; the full strict Node-test compilation, maintained tooling types, architecture/controller/size checks and normal three-product hidden-map builds also passed. Startup tightening changed no budget. The post-audit verified 52,115 inputs, absence of all 300 observed identities/root sessions and 299 stable raw profiles; coverage remains unparsed and unadmitted. This is not a fresh complete all-product Node or canonical static-gate pass. |
| Optional memory-accounting diagnostics, `036899f59` | Two original observer paths first reproduced dropping valid detail fields. The fix retains backing storage/embedder bytes and eight Linux private/shared/anonymous/file categories from the existing responses and rollup reads. All 87 focused controls passed, including unchanged request/read counts, required-field refusals, missing/malformed/duplicate optional data and original cap/ownership checks. Optional absence is unavailable, not zero; overlapping categories do not prove allocation ownership. No application, policy, dependency or assistance-runtime bytes changed. |
| Current controlled-duration browser profile, `036899f59` | One run passed both 300 and 1,200 frames: real preview, PNG/WebM, independent picture/timestamp/bounded lossy Opus references, cancellation/retry, memory tails and cleanup. All 545 memory rows were audited; peak whole-application RSS/PSS was 2,029,117,440/966,450,176 bytes, with a maximum sample gap of 438.226 ms. All new accounting fields were available. Both applications closed 0/null with no cleanup errors; all 46 recorded/session identities were absent, 52,115 inputs and 2,293 site/map bodies were unchanged, and port 4974 was free. Original limits, launch flags and assertions stayed unchanged, without GC, heap override or an additional workload invocation. This fixed Chromium software-profile pass does not explain or reinterpret earlier failures, qualify native maximum workloads or close the complete application browser gate. |
| Current Linux native staging/packages, `036899f59` | All six maintained helper-verification, Motion/successor staging, unsigned directory-packaging and resource-verification phases passed. The existing authenticated `f66040509` helper was reused through the maintained verifier; no native/reference compilation or GUI/decoder invocation occurred in these phases. Fresh stage/package inventories contain 1,946 files. All 16 recorded identities and six phase sessions were absent; source/npm/prefix and held old-package guards passed. At package completion, sandbox copies were ordinary user files and the previously installed helpers were unchanged. The later installed aggregate has its own custody and functional evidence below; preparation alone does not qualify a workload. |
| Current installed Linux five-workflow aggregate, `036899f59` | Passed native launch, animated scene, menu-authored title, successor picture/PCM delivery and saved-file linking, with five exact-source markers and the original picture, alpha, timestamp and audio bounds. All six command receipts closed 0/null; the authored application also closed 0/null. Other legacy application drivers await closure without asserting its numerical code. All 66 input pins, 1,946 generated files and 172 prefix files passed pre/post checks; 145 durable outputs were preserved and 71 identities/six sessions were absent. Writer, known port, owned display and original sandbox-helper metadata checks passed. This qualifies the fixed Linux x64 software profile; current native duration, maximum workloads, other hosts and signing remain separate. |
| Current controlled-duration native profile, `036899f59` | Closed failed during the 300-frame encoder-cancellation retry: chooser 6 reported that the save dialog remained open after selection. Two movies were preserved, but the 1,200-frame workload, independent output checks and duration-tail comparison were not reached. The chooser retained no window/focus/key chronology, so its cause is unknown. Application closure was 0/null; cleanup also retained a secondary ESRCH observation. All 245 declared references, 213 runtime pins, 1,946 generated files, 172 prefix files and original sandbox-helper metadata passed file-only checks. All 29 recorded identities/ten sessions were absent; 144 original/copied output files were identical and stable. The actual display number was not retained; absence of the default display candidate is not authenticated display closure. No retry or qualification pass is claimed. |
| Current installed native maximum profiles, `036899f59` | All four original cases passed once each: 64 shutter ×64 lens samples with real shadows, 64 contributing planes at 1,024², 32 lights and the 32,768-frame index. Normal per-case reference compilation and independent decoding passed with unchanged color/alpha/PTS/PCM, memory and deadline bounds. The index passed 32,769-frame refusal, upload cancellation at frame two and same-job/original-revision retry; all 32,768 timestamps were contiguous and all 52,428,800 stereo PCM sample frames were exact. Its six warm/41 tail rows yielded PSS growth 38,149,120 bytes below the original 67,108,864 ceiling, with 130 real encoder observations. All 4,700 preview/render rows, 532 durable files, 25 command receipts and source/package/helper/prefix checks passed; 84 recorded identities/25 sessions were absent. The nested decoder last-scan zombie and later foreign reuse of the lights display number remain explicitly distinguished from fresh owned-process absence. This fixed Linux x64 software-profile pass neither clears the older PSS failure nor establishes its cause or broader host/combined-gate acceptance. |
| Complete static gate, `a1a58bf4e` | Passed full lint, types, architecture, audits, documentation and production build with the command-local 12 GiB compiler heap. Exact source and all 85 observed process identities closed; startup tightening found no ceiling to lower. The later polling repair retains its own checks and exact test-byte attribution. |
| All five exhaustive Node partitions, `a1a58bf4e` | Passed: 27,352 tests, 27,338 passed, zero failures/cancellations and 14 declared skips. All 1,121 Motion cases and the three previously failed nightly packaging assertions pass in the same exhaustive batch. Source/staged inputs, observed process closure and stable raw-profile inventories passed; raw coverage remains unparsed and unadmitted. No Node heap override was set. |
| Complete static gate, `322c8a6b1` | Passed full lint, types, architecture, audits, documentation and production build, with the explicit 12 GiB compiler heap confined to this command. Source and observed process closure passed. Startup tightening found no ceiling to lower. |
| All five exhaustive Node partitions, `322c8a6b1` | Closed failed: 27,352 tests, 27,335 passed, three failures and 14 declared skips. All three failures share the omitted concurrent-export fixture in nightly test payload membership. Common-1, Frame, Sound and all 1,121 Motion cases passed; the isolated common-2 desktop deadline probe also passed. Source/staged inputs, observed process closure and stable raw-profile inventories passed; coverage remains unparsed and unadmitted. |
| Nightly fixture staging repair, `d75950a25`, integrated as `703ca954b` | The existing tests reproduced exactly the three packaging failures on the unchanged base. Adding one fixture path makes all 22 relevant payload/import/negative-omission and actual staging checks pass, without skips. Changed-file lint, size and diff checks passed. No application, dependency or assistance-runtime bytes changed. This focused result does not replace the failed complete Node run. |
| Complete handbook browser gate, `322c8a6b1` | Passed all 32 maintained desktop/mobile Chrome cases once, four workers and no retries, with the original test/assertion timeouts. Source/build preservation and all observed process, daemon, port and output-writer guards passed. The known inaccessible sd-pam environment remains an explicit census limitation. |
| Complete ordinary browser run, `322c8a6b1` | Closed failed: all 7,563 discovered cases are accounted for, with 7,228 passed, 48 failed and 287 declared skips; no retries, flaky outcomes or report-global errors. Chromium passed 2,497/failed seven/skipped 17; Firefox 2,399/four/118; WebKit 2,332/37/152. All 438 Motion-named cases account for 436 passes and two declared skips, but all 48 failures in shared/other-product spec files still block acceptance. All 39,875 inputs, 74 preparation pins and 2,293 site/map files were unchanged. All 18,197 recorded identities and 95 observed sessions were absent; known ports/writers closed. The 2,343 stable raw profiles remain unparsed and unadmitted. |
| Fresh Linux native staging/packages and aggregate, `322c8a6b1` | All eight native/reference build, staging, packaging and verification phases passed. The fresh application aggregate completed all five functional markers, including the animated-camera fixture, and its command exited zero. The strict outer gate nevertheless failed because an owned descendant was still live at command closure; cleanup left no recorded survivors or zombies. The descendant's executable was not captured, so its cause is unproven. This is a failed aggregate, not Linux acceptance. The same two previously installed sandbox-helper inodes were relocated with an audited journal; old installed metadata is explicitly historical and invalidated, while old bodies and receipts remain preserved. |
| Corrected Linux native aggregate, `322c8a6b1` | Passed all five installed-package workflows: own-origin launch/file custody, animated camera/lighting, authored title, offline successor picture/PCM delivery and saved-file updates. A private copy of the Xvfb launcher now waits for its owned X server after the existing shutdown signal; six controlled launcher cases passed before this run. The strict owner and all source/artifact/process guards passed. This qualifies the tested Linux x64 software profile; the earlier aggregate failure and its unknown descendant executable remain recorded. |
| Complete linked and dual-origin suites, `322c8a6b1` | Linked closed failed with 38/39 passes: Chromium 12/13, Firefox and WebKit 13/13 each. The sole failure is a transient real-playback pixel poll; its trace and failure artifacts are retained. Dual-origin passed all nine cases, three per engine. Both suites used one worker, no retries and unchanged assertions/timeouts; source/site/port/process/writer closure passed. This is not a complete linked-suite pass. |
| Mixed-preview polling repair, test bytes committed as `845991e83` | All six original cases passed once, two per engine. The retained failure trace shows a sampling gap across the authored bright image interval; the test now samples its same >80 real-playback condition every 50 ms. Original pixel bounds, 15-second expectation, real Play/Stop, reopen, New and error assertions remain unchanged. Strict types, changed lint, size and normal paired builds passed. The actual sites/run used `322c8a6b1` plus these exact held test bytes; this focused result does not replace the failed 39-case suite. |
| Complete linked suite after polling repair, `453f03c4b` | Closed failed with 38/39 passes: Chromium 12/13, Firefox and WebKit 13/13 each. All six mixed-preview cases pass in this full suite. The sole failure is now Chromium's Conform review-removal expectation: the new accepted digest was saved, but project activation remained pending after the unchanged 15-second wait. The trace does not identify the slow activation phase. All 118 recorded/session identities were absent; source/input/site/port/writer guards passed. There were no retries, skips or flaky results. |
| Additive Conform phase observations, private `1003223e6` and `54134eed5` on `5c8eaa030` | Both original Chromium workflows passed with unchanged 120-second case and 15-second review expectations, one worker and zero retries. The first capture lost its page-local ring at the case's later reload. The second drained before that reload and retained all 25 begin/end phase pairs: Apply to observed review absence and activation clear was 5,855 ms, with 2,224 ms before the first activation marker and 3,594 ms in activation. Its longest marked await was storage GC at 522 ms. Neither reproduced the historical failure or proves its cause. Source/site/process/writer guards passed. Instrumentation was not merged; both private commits, source and ignored bodies were preserved before normal worktree retirement. |
| Touch-console observation repair, `8a54866b2` | All five original Chromium cases passed once, including both interrupted native gestures and their drag/Undo/Redo checks. Two assertions now wait for the same exact console-event arrays through the existing five-second expectation; native inputs and 30-second case limits remain unchanged. Changed lint, browser types, size, normal three-product build and source/site/process/port/writer guards passed. This repairs test synchronization, without claiming a historical application cause or a complete browser-suite pass. |
| Current controlled-duration browser profile, `322c8a6b1` | Closed failed at the existing memory ceiling during the first 300-frame preview. Five accepted samples all record zero completed frames; exports, cancellation/retry and 1,200 frames were not reached. The sampler threw before retaining the rejected row, so the exact offending RSS/PSS/heap/WASM operand is unknown. Fresh source/input/site, process, server and output-writer closure passed. No cap changed and no duration or memory-growth qualification is claimed. |
| Current controlled-duration native profile, `322c8a6b1` | Passed both 300- and 1,200-frame preview/ProRes workloads, cancellation during upload and encoding, and retries. All six MOVs passed independent picture/alpha, contiguous timestamp and exact PCM checks. The audit verified all 427 memory rows, including 68 real encoder observations; peak whole-application RSS/PSS was 1,088,049,152/630,641,664 bytes and all memory-growth limits passed unchanged. Source/artifact and final process/writer closure passed. This qualifies the fixed Linux x64 software profile, not maximum workloads, other hosts or the failed browser profile. |
| Memory-refusal evidence repair, `7ae10f1b0`, integrated as `d5347085e` | A new sampler-path test reproduced the original limit error with no rejected row. The repair retains one terminal row with all exceeded limits and exact process/isolate/WASM operands, then throws the same error. Accepted samples and numerical limits remain unchanged; write/sync/short-write failures retain bounded incomplete-evidence metadata. All 39 focused checks, strict test/browser/tooling types, changed lint and size checks passed. The complete Motion partition passed 1,127/1,127 with no skips or heap override. This is diagnostic coverage, not a new browser duration pass. |
| Controlled-duration browser profile with rejection evidence, `7ae10f1b0` | Closed failed during the first 300-frame preview. The retained terminal row identifies only aggregate RSS above its limit: 2,154,524,672 bytes versus 2,147,483,648 (7,041,024 bytes over). PSS was 966,806,528 bytes; JS used heaps were 109,012,152/4,279,072 bytes and WASM capacity was 134,217,728 bytes, all below their unchanged limits. Six accepted rows precede the rejection; separately sampled UI/worker progress was four/five frames. No export, cancellation/retry or 1,200-frame qualification was reached. All source/site/process/writer guards passed. This uses the fresh ordinary Motion site; the prior paired-site result remains separate. Process roles and allocation cause remain unproved. |
| Four-case browser failure observation, `7ae10f1b0` | All four original Chromium workflows passed once with additive diagnostics: desktop strip meters, source-spectral clock, neighboring-bin EQ and timeline spectrogram options. Original actions, predicates and 90/60/60/30-second case bounds were retained, with one worker and no retries. Source/site/process/port/writer guards passed. No failure-only snapshots were emitted, so those capture branches were not exercised. These are non-reproductions, not fixes or explanations of the complete ordinary run's failures. |
| Browser RSS process observation, `7ae10f1b0` | The single diagnostic run failed at the unchanged RSS limit: 2,156,822,528 versus 2,147,483,648 bytes. PSS, JS heap and WASM remained below their limits. A bounded pre-cleanup snapshot retained all 16 stable process identities; CDP identified 12 roles, while the observer left four command lines unclassified. The observer therefore closed with incomplete role attribution, independently of the original workload failure. Its later RSS decomposition is not simultaneous with the rejected row and does not prove an allocation cause or leak. All 25 outer/nested identities were absent after cleanup; input/site/writer guards passed. No retry or threshold change. |
| Lazy preview audio output, `d78e8401c` | Meaningful regressions first reproduced eager context creation on visual-only preview. The default output is now constructed and resumed on Play; supplied-output ownership and cleanup remain intact. All 1,131 Motion Node cases and 15 original preview/media cases across Chromium, Firefox and WebKit passed without retries/skips or a test heap override. Normal three-product builds, startup tightening, strict types, changed lint, size and source/site/process/writer guards passed. This fixes the eager allocation; it does not establish the complete RSS failure cause. |
| Controlled-duration browser profile after lazy audio, `d78e8401c` | Closed failed. The full 300-frame preview, PNG/WebM, independent pictures/timestamps/bounded lossy Opus checks, cancellation/retry and cleanup completed. The fresh 1,200-frame preview then exceeded the same RSS limit at frame 46: 2,149,208,064 versus 2,147,483,648 bytes (1,724,416 over). PSS, JS used heaps and WASM remained below their original limits. The 1,200-frame exports and duration-tail comparison were not reached. All 45 observed identities were absent; 52,099 input files, 16 armed references and 2,293 site/map files remained unchanged. No retry, cap change or allocation-cause claim. |
| Native maximum-workload harness, `a4e851dc3`, integrated as `2978ab0cc` | Fifteen added qualification-only files provide fixtures, independent picture/PCM oracles, a bounded installed-app driver and a separate compiled decoder. All 17 focused controls, strict types, changed lint, size and source/package preservation checks passed. Seven decoder refusal controls passed after an external wrapper's metadata mistake was corrected; the failed wrapper is retained separately. Application, installed package, fixed-duration policy and assistance-runtime bytes are unchanged. |
| Installed native maximum scenes, application `322c8a6b1`, driver `a4e851dc3` | All three passed once: 64 shutter ×64 lens samples with real shadows, 64 contributing translucent planes at 1,024², and 32 positive shadow lights. Full-pixel preview and independently decoded ProRes picture/alpha/timestamp checks passed. Absolute memory, strict process closure and source/package/prefix guards passed. These qualify the tested Linux x64 software profile only. |
| Installed 32,768-frame native index, application `322c8a6b1`, driver `a4e851dc3` | Closed failed after completed publication. The public 32,769-frame refusal, real upload cancellation and same-revision retry passed. All 4,154 memory rows met absolute/cadence limits, with 125 real encoder observations, but warm-to-tail median PSS grew 70,988,288 bytes against 67,108,864 (3,879,424 over). RSS, JS heap and WASM deltas passed. All recorded identities closed and source/package/prefix guards passed. A separate decoder-only check of the preserved 324,431,816-byte MOV passed all 32,768 contiguous timestamps, all 52,428,800 exact stereo PCM sample frames and selected full-picture/alpha bounds. This file fidelity pass does not clear the original memory refusal; no leak or allocation cause is established. |
| Complete static gate, `8cc261339` | Passed full lint, types, architecture, audits, documentation and builds, with an explicit 12 GiB compiler heap. Source and observed process closure were verified. The later M06 changes retain their own focused checks; this result is not retagged to newer source. |
| All five exhaustive Node partitions, `17b8a6964` | Passed: 27,295 tests, 27,281 passed, zero failures/cancellations and 14 declared skips. Motion's 1,095 tests passed without skips, including real pinned-helper MOV decoding. The isolated desktop deadline and paired-download cases passed in the unchanged complete gate. No Node heap override was set. Source, staged inputs, observed processes and raw-profile closure were verified; raw coverage remains unparsed and unadmitted. |
| All five exhaustive Node partitions, `3e8b3e942` | Closed failed: 27,286 tests, 27,270 passed, two failures and 14 declared skips. Motion's 1,086 tests passed without skips, including real pinned-helper MOV decoding. Common-2 failed the isolated desktop AudioWorklet deadline check; Sound failed a paired-download test that observed the second archive before its report. All partitions and owned processes closed. |
| Paired-download test repair, `b2688a52d` | All five original test-file cases passed after waiting for the existing action's completion across its release timer and MessageChannel task. Exact filenames and blob retention/revocation assertions remain unchanged. Strict types, changed-file lint and size checks passed. This focused result does not replace the failed whole Node gate. |
| Desktop deadline diagnosis, `3e8b3e942` | Two bounded passive observations passed with exact PCM and no deadline fault. Neither reproduced the historical failure. The first omitted the gate's coverage/loaders; the second restored them but added an unproven 8 GiB heap setting. The cause remains unknown and no production repair is claimed. |
| Complete ordinary browser run, `3e8b3e942` | Closed failed: 7,542 cases, 7,215 passed, 40 failed and 287 declared skips; no retries, flaky cases or global errors. Chromium failed 14 cases, Firefox five and WebKit 21. Missing independent FCPXML/EDL readers are a checkout prerequisite error, corrected only in the separate newer run. All 17,441 recorded identities and the root session are absent; source/site/port/writer guards passed. The 2,336 stable raw profiles remain unparsed and unadmitted. |
| Passive Import/Split observation, `3e8b3e942` | The original single Chromium workflow passed once with bounded passive focus/key observation. All 63 recorded events fit the cap, and the shortcut opened its chooser. No focus steal was observed. This changes scheduling and does not reproduce or explain the full-run timeout. |
| Deferred panel focus repair, `01e0f3d55` | Deterministic controls reproduced an older queued handoff overriding a newer user focus choice. The fix retires superseded requests while preserving trigger restoration and the original 30-frame mount bound. All 71 focused cases, eight dispatch controls, strict types, lint, architecture and build passed. The default-heap test typecheck exhausted memory; its explicit 12 GiB retry passed. This proves a separate focus defect and does not establish the cause of the browser Import timeout. |
| Saved-kind and mixed-rate consumer contracts, `82c9aaa3f` / `bcdc43f1f` | New controls preserve all ten layer kinds, animated property kinds and exact asset bodies through store/archive reopen; an authored rational-clock/pixel oracle agrees across actual preview playback, shuffled seeks, export, saved links and Frame thumbnails. These are Node/CPU and instrumented-IndexedDB checks, not physical-browser durability or codec qualification. Four final focused cases passed after repairing an existing test's missing temporary-directory parent. The initial auxiliary Motion shard remains failed: 1,094/1,096 passed, one setup failure and one native-artifact skip. |
| Animated multilingual title, `cf8717b6d` | The strengthened original workflow passed Chromium, Firefox and WebKit once each. It authors English/Arabic text and animated title placement, checks Undo/Redo and retained font/shaping after reopen, and delivers 16 PNG frames; differing frames 0 and 15 each match reopened preview within the unchanged one-code bound. Three new scale/rotation/tracking controls and 13 combined Node cases passed unchanged application code. Strict types and final lint passed; earlier setup/type and default-heap lint failures remain retained. |
| Graph/path keyboard repair, `e13c9f4bb` | Real component and Chromium controls reproduced Enter/Space failing to select focused SVG buttons. The fix selects without authoring or adding Undo history, while preserving disabled/modified/IME/repeat and existing arrow behavior. All 38 combined Node checks, 12 new cases across three browser engines and four existing Chromium workflows passed, with strict types, lint, size and Motion builds. |
| Expression export diagnostics, `97c002d67` | New real final-export cases reproduced missing layer/property/source-span context. Shared presentation now retains that context in Render and the pinned queue, including bounded cleanup-error aggregation without losing cleanup capabilities. Final 59 combined Node checks and two Chromium refusal/correction/reopen/PNG cases passed with strict types, lint, size and Motion build. The earlier 15-case browser pass predates the aggregate-message extension and remains separately attributed. |
| Animated camera reference, `99183fd6c` | Independent world/projection values, frozen-subject and frozen-camera pixel controls, arbitrary seeks and matching-quality host preview/export pass. The menu-authored Chromium camera workflow checks independently predicted pixels, save/reopen and PNG delivery. The native fixture now animates its camera while retaining its lighting/shadow/shutter/lens checks; the later `322c8a6b1` aggregate qualifies that fixture on Linux x64 software rendering. This strengthens test evidence without changing renderer math. |
| Passive spectral-gesture observation, `8cc261339` | The three original Chromium workflows passed once with bounded passive pointer observation, no original assertion/timeout changes and no application repair. All captured brush releases arrived; no observation overflow or page error occurred. The separate origin/one-worker observation does not explain or clear the full-run failures. |
| Original browser MP4 observation, `8cc261339` | The unchanged single Chromium case failed its original pixel bound: second-frame blue was 169 against expected 191, an error of 22 versus the limit of 20. Packet/container checks reached the pixel loop. The earlier selector-only attempt executed zero cases and remains a separate preparation failure. Source/site guards and process closure passed; encoded bytes and native planes were not retained by the original case, so no producer, muxer or presentation cause is established. |
| Retained MP4 file/presentation diagnosis, `8cc261339` | An additive capture reproduced the same original 22-versus-20 failure and retained the actual producer RGBA, encoded MP4, native decoded planes/tags and reconstructed same-plane Canvas control. Independent static FFmpeg decoding of that exact file matches all six complete visible plane hashes, twelve sampled Y/U/V values, timestamps and Rec.709 limited-range tags. Independent matrix and inverse-transfer arithmetic puts the sampled file colors within the original sRGB limit; actual and same-plane Canvas retain the failed presentation values. The original case remains failed; no production encoder change or relaxed color limit is claimed. |
| MP4 file-color oracle correction, test bytes committed as `ebaa5034b` | Both original Chromium export workflows passed once with their original 20/12-code bounds, authored color/alpha expectations and timeouts. Independent limited-range Rec.709 matrix and inverse-transfer arithmetic measures file sRGB; strict metadata, format, order and timing checks refuse ambiguous inputs. Original Mediabunny/HTML readbacks must equal the separately reconstructed same-plane Canvas control and remain retained, including the earlier failing presentation values. Seven helper controls, strict types, changed-file lint, size and normal product builds passed. The actual build/run used source `80f80bbbe` with the four held test changes, now committed unchanged; this does not retag its site evidence to the later commit or qualify the complete integrated gate. |
| Fresh handbook attempt, `8cc261339` | Interrupted and failed: the small-command observer reached its 64 cumulative-process cap after 14 visible desktop passes, before complete report/teardown. This is not a 32-case pass. Independent salvage verified source/build custody, absence of all 63 recorded identities and owned sessions/daemon/port, then removed only the stale scoped preview lock. A suitable whole-suite observer is being prepared for a later final-source run. |
| Retained mixed-image reopening, `cbf09f9ea` | The unchanged workflow passed Chromium, Firefox and WebKit, without skips or retries. Per-file read serialization fixes the reproduced same-worker exclusive OPFS lock collision; the retained image was intact. This does not claim cross-worker or read/write arbitration. |
| Complete linked/dual-origin suites, `19bc434e8` | Closed failed: 34/36 linked cases and 8/9 dual-origin cases passed. Firefox failures were image reopening and an absent-host GPU assertion; WebKit lost the archive of a two-download pair. All three first linked-editor/offline/export workflows passed. |
| Fresh complete linked/dual-origin suites, `c61839c8d` | Closed failed: 34/36 linked and all 9/9 dual-origin cases passed. Chromium failed on a native-export audio-clock gap; WebKit failed while waiting for Resume to adopt a saved revision. Firefox passed all linked cases. GPU/loss/restore checks passed on capable hosts. |
| Native linked-export variants, `c38e0c2a2` | Both unchanged variants passed in all three engines: six cases, without skips or retries. Native PCM delivery now keeps its capture clock running under bounded backpressure; deterministic controls still reject actual clock loss and blocked sinks. This earlier focused result alone did not close the full suites. |
| Complete linked/dual-origin suites, `1887abecc` | Passed all 36 linked and nine dual-origin cases across Chromium, Firefox and WebKit, without failures, skips or retries. All three first linked-editor/offline/export workflows passed with real exports and retained current-release bodies. Chrome I420 and WebKit NV12 plane checks passed; Firefox's native BGRX result remains plane-unqualified. The separate Chromium absolute-HTML blue-241 limitation is retained. |
| Concurrent saved-update/export regression, application base `b594cb562` | New controller and actual browser native-consumer regressions fail: compatible revision B is durably accepted while A's export is active, but the same-owner adoption cancels A. The browser pauses its first real float-picture IPC write and confirms B's saved digest and history before observing cancellation. These failed regressions remain retained; earlier serial/disconnected exports did not close this coupled M10 gate. |
| Concurrent saved-update/export and cleanup repair, `d7d694fd0` | The corrected workflow passes Chromium, Firefox and WebKit without retries/skips: B is durably accepted while A's first picture write is held; A retains all captured picture/PCM/original bytes, the later export contains B, and asynchronous input cleanup blocks publication. Controller controls retain strict cancellation for actual owner/authoring changes and duplicate-offer behavior. Fault-injected closes in the real engine and owned-worker disposal reproduce lost cleanup handles; the repair retains and retries those handles while public use stays disposed. Focused Node, strict types, lint, architecture and fresh Frame/Motion builds pass. The earlier scaled-fixture oracle and wrong-build setup failures remain separate failures; the final opaque fixture keeps exact all-pixel/frame/PCM bounds. This is a controlled browser IPC sink, not a fresh installed-codec or complete integrated gate. |
| Required five-workflow Linux aggregate, `1a788b61b` | Passed launch, scene, authored title, successor picture/PCM and saved-file link workflows. The authored workflow covers actual New, shape/text authoring, native Save, preview and cancellation/retry. Its decoded RGB error was 3.93/1023 against the unchanged eight-code limit; alpha was exact. The complete five-workflow aggregate admits Linux x64 only; other targets remain open. |
| Fresh five-workflow Linux aggregate, `1202edeba` | Closed successfully with all five source-bound markers, source/artifact guards and final absence of all 74 recorded process identities. Independent completed-evidence audit passed without replay. The unchanged legacy launch/scene/successor scripts await Electron closure without retaining its numeric code/signal; strict command closure must not be described as a new per-Electron exit-code assertion. |
| Six unchanged WebKit regression workflows, `cbf09f9ea` | Punch, three tempo workflows, musical selection and configurable-effects search passed, without skips or retries. Non-reproduction does not establish the causes of their earlier failures. |
| Controlled-duration browser workflow, `fa68087f7` | Passed both 300- and 1,200-frame workloads: preview, PNG/WebM output, independent picture/timestamp/audio checks, actual cancellation/retry, memory limits and cleanup. All 591 memory rows were audited; peak RSS was 2,078,101,504 bytes, below the unchanged 2 GiB bound. This qualifies the fixed software Chromium profile, not maximum workloads or other hosts. |
| Controlled-duration native workflow, `fa68087f7` | Closed failed after generating the 300-frame movie, when encoder identity/argv observation was rejected. Fourteen real encoder-memory observations exceeded the unchanged minimum of three. Output-only diagnosis subsequently passed selected pictures, all timestamps and exact PCM, but cannot qualify that failed invocation, which did not complete cancellation/retry, 1,200 frames or the memory comparison. |
| Controlled-duration native workflow, `5ca4a2ea1` | Closed failed during application shutdown with SIGTRAP, after all three 300-frame movies and cancellation/retry. File-only reference checks passed for those movies; 1,200 frames did not run. The exact shutdown signal chronology was not captured, so the historical cause remains unproven. |
| Native shutdown repair, `d49ce710f` | The observer sends graceful termination to the application owner first and awaits closure before authenticated residual cleanup. Nine new controls and 93 combined observer/CDP regressions passed, including a real parent/dependent process control. Strict application exit and signal refusals remain unchanged. |
| Controlled-duration native workflow, `1202edeba` | Passed both 300- and 1,200-frame preview/ProRes workloads, cancellation/retry at each duration and all six independently decoded MOV references. All 449 memory rows and 81 real encoder observations were audited; peak whole-application RSS/PSS was 1,075,535,872/625,772,544 bytes. Exact PCM, contiguous timestamps, picture/alpha bounds, memory tails and final process absence passed. This qualifies the fixed Linux x64 profile, not maximum workloads or other hosts. |
| Complete accepted coverage union and external matrix | Open. Failed raw profiles remain unparsed and unadmitted; no coverage floor, startup ceiling, timeout, color bound or signal bound was weakened. No installed AE environment is available. |

The current diagnostic implementation is pinned by
`memory-detail-diagnostics-6fd47e0a0/qualification.json`, SHA-256
`fa1b01506cb543f1f1c55f1c3c5c6e82d28caf2e76d607332273faa70bbea125`.
The complete Motion partition and full Node-test type check are recorded in
`current-036899f59-node-motion/qualification.json`, SHA-256
`b83ad633069cc1e0d7b3a311bb2e5c2652110d113d11de12918a48c664275a0d`.
The normal product-build receipt is
`current-036899f59-browser-preview/build-qualification.json`, SHA-256
`e0f52319b6fcb5d3bec9cd0f0304bd42a936fb7cd26a2c0ac086d875008123a1`.
The single passing duration observation and its cleanup/accounting audit are
`current-036899f59-sustained-browser/qualification.json`, SHA-256
`d6730658fa9800278051e4ca78f18a8e1daae8e5026ba6386201d7bb00d8dd68`.
The current-source unsigned native package preparation is
`current-036899f59-native-qualification/completed-qualification.json`, SHA-256
`1e039538742a2f0ebb65274e20bc9eeddd782ddd353d2bc0a26c44799ccaff70`.
The subsequent installed aggregate and retained-output/closure audit are
`current-036899f59-native-qualification/aggregate-audit/qualification.json`,
SHA-256 `9a322268063db5ba7034c5c6b96b4d2ab421ba9f2ccf054167951af6e2289ea1`.
The complete static gate is
`current-bbb172047-static/qualification.json`, SHA-256
`9ba804f0a32b894a70200f3cf96afe45c42422d8fff6ba2eb3463fc6127e83e7`.
The failed current-source native-duration invocation and file-only closure are
`current-036899f59-sustained-native/actual-tool-closure.json`, SHA-256
`62d7682bc2b8a38274c76b87c03825a0b6c361165331931a8e732faa230fe14a`.
The shared Amplify repair and its build/browser/input/process audit are
`amplify-selection-intent-fix-bbb172047-20261015/qualification.json`, SHA-256
`628ae7e3c0f392f8583884519932fc9145ce3e57f3e4d2f3220fc68ec3f45b37`.
The passive chooser diagnostic and its offline controls are
`chooser-observation-17aea837d-20261015/qualification.json`, SHA-256
`1e24bc3a51190447b60face86f60a5336f0144b15ba253064d68acf91aa235b5`.
The vanished-process read repair is
`proc-read-race-fix-4f596f9dd-20261015/qualification.json`, SHA-256
`bc763dbc9cdc02a452487bf308b6564ee351faf164ed94061b6e6b13cf6c1a98`.
The four current maximum profiles and completed output/memory/closure audits are
`current-036899f59-native-maximum-preparation/qualification.json`, SHA-256
`b34f1aa1b3ba177aed1218c6dd77a8d6ac171e1fe4b10669c0b6b8890f80783f`.
The native-selection repair qualification is
`amplify-native-selection-db4-20261015/qualification.json`, SHA-256
`c54d349cc83f6ef6b574265bea4c4ace52422ded817e892c598ed874551e9977`.
The complete static gate on `c6033a71a` is
`current-c6033a71a-static/qualification.json`, SHA-256
`4cf2c2850f37a788c33ce93040ee6432f3ae1a8d45d67ed932d15fcaa93fad2c`.
The six native preparation phases on `c6033a71a` are
`current-c6033a71a-native-qualification-v2/six-phase-qualification.json`, SHA-256
`f3882ab097820497ff97556f871cea55a6159ec5a35dc8a5ff715bd3890e73d7`.
The complete all-five Node gate on `c6033a71a` is
`current-c6033a71a-node/qualification.json`, SHA-256
`a2ef6278f1e37fd9ecb0b150b2303e3cbe7b4b7fafd87b86404b3059d82684c9`.
The complete all-five Node gate on `db4e586d0` is
`current-db4e586d0-node/qualification.json`, SHA-256
`baf7db57edfb6fc0519049a55bfc11889848daace4f8404df572191a7f43757b`.
The latest failed complete Node post-audit is
`current-2f1ffce7f-node/post-audit.json`, SHA-256
`d2bda9b97d453573633bd4b53736bfe17f6aded9062ce51411fc200bd14a7723`.
Its focused staging repair is
`nightly-range-touch-input-2f1ffce7f-20261015/qualification.json`, SHA-256
`7cf3cb63e53b5a9474e611a23a24c13571f875a1974313d912ff1ba04fca73c3`.
The complete static gate on `db4e586d0` is
`current-db4e586d0-static/qualification.json`, SHA-256
`08b2ce1890c38866763dfc88c5c8d075f942ac154559bf5ea6aadab69a1c42b9`.
The latest failed static attempt is
`current-2f1ffce7f-static/qualification.json`, SHA-256
`0d386c07ebcd4654f09c8e69cd39c88ba0b829bc5c31c2352b984f850edb0136`.
The completed failed ordinary-browser audit is
`ordinary322-final-audit-20261015/qualification.json`, SHA-256
`87de13e6532931235e0fd1dc468922306512f591938f9a31fd7b86d7b50ff0ae`.
These receipts retain their individual scopes and do not promote a milestone.

The preceding complete Node run failed. Its receipt is
`current-322c8a6b1-node/closed.json`, SHA-256
`23d31d48a3bf55f381553740a605154a15f45760713c94035f4c2ef53a423f33`;
its post-audit is `current-322c8a6b1-node/post-audit.json`, SHA-256
`1ffd2e2a1d385ea287344bb3a4798fb1e77dc9eba4e524af59563a0025827fab`.
The audit verified 51,392 source/installed inputs, absence of all 5,416 recorded
identities and five root sessions, and 5,283 stable raw profiles totaling
13,267,533,253 bytes. These profiles remain unparsed and unadmitted.
The staging-repair receipt is `nightly-concurrent-fixture-fix-322c8a6b/qualification.json`,
SHA-256 `1b5dd31bdc0901477b8b4f798d69c4340fd75dde06f05234e0b8ae9567ad1b3b`.
The preceding static receipt is `current-322c8a6b1-static/closed.json`, SHA-256
`d54611d2f07b389398a60b9c7f9cac2e0a24b1402e41aeb8e046587b7511399f`.
The complete handbook receipt is `handbook-final-browser-322c8a6b1/closed.json`,
SHA-256 `67daed7548a0b8a017336d80365a32593e800eb9c70c5f4b01639f1ae49608b8`;
its actual tool closure is `handbook-final-browser-322c8a6b1/outer-tool-closure.json`,
SHA-256 `c3186305458861f7035189a7f6e2839e4065cca3296cc1afe112aa5a91b02325`.
The fresh native build/package closure is
`current-322c8a6b1-native-qualification/outer-tool-closure.json`, SHA-256
`755ee87f8fabdf10ac251382b3d87c67775b4141fcfd0e36e5c6cde5158fc7f7`.
Its helper relocation is
`current-322c8a6b1-native-qualification/sandbox-custody/outer-tool-closure.json`,
SHA-256 `ea51b0ea163ab5ce6b6658686c724cf47e359c20c91137513d7c708db05273e9`.

The new complete static receipt is `current-a1a58bf4e-static/closed.json`,
SHA-256 `4075f6155ef5eae5e9100d770d4467de61e46f9d89cf45ea1c27904857da1aed`.
The closed failed ordinary run is
`current-3e8b3e942-ordinary-preparation-v2/ordinary-run/actual-tool-closure.json`,
SHA-256 `880f367c465ba8b40550cf82ecdaae24358cc80f62882d2c1b90525103d7fa20`.

The new passing complete Node handoff is `current-a1a58bf4e-node/handoff.json`,
SHA-256 `ea8e35eb59e519fd5c2a30e04eaa0a9d8c7a48a60f55c393c58ebb5b7f235b6e`.
Its post-audit verified 51,392 inputs, absence of all 5,486 recorded identities
and five root sessions, and 5,265 stable raw profiles (13,260,012,986 bytes).
The profiles remain unparsed and unadmitted. The corrected native aggregate audit
is `current-322c8a6b1-native-qualification/aggregate-wait-audit/actual-tool-closure.json`,
SHA-256 `f99ef3ac8d1d1adee77b6cecfb75faa047d9dcce515cc171961faca0e1ea89b7`.
The linked/dual-origin completed handoff is
`current-322c8a6b1-linked-dual-preparation/completed-handoff.json`, SHA-256
`e084e117cc5da5e157434e46b733f738cf5a156c78ed9e28e0ff6a9469bfd793`.
It records the single linked-case failure separately from the nine-case pass.

The focused mixed-preview repair qualification is
`mixed-preview-poll-interval-fix-322c8a6b1/qualification.json`, SHA-256
`01987cd60425229e375d288b92e00956ec239594037a16aaf6c1b5790cd9bcb2`.

The touch-console qualification is
`touch-console-observation-322c8a6b1/qualification.json`, SHA-256
`1bf06fd480735ea6408c85b942cb81fb9d034732783cd3eceac20999f2db642a`.
The failed current browser-duration closure is
`current-322c8a6b1-sustained-browser/actual-tool-closure.json`, SHA-256
`7a3dc3c81cfdeedc8bad546a3d965ceda3f39996ace867abfe66f92d656272fa`.
It preserves the failed workload separately from its successful cleanup audit.

The passing current native-duration closure is
`current-322c8a6b1-sustained-native/actual-tool-closure.json`, SHA-256
`9b1a36fad3e8c11e38b43f169c4a4121cbbeecfa67a594d30376d00f456eefc4`.
Its completed-output and memory audit is
`current-322c8a6b1-sustained-native/qualification-audit.json`, SHA-256
`704f8772b6e64bafc1102f390034ad4ea9d4660e572e87fcec11c2e9b0839f91`.
The combined handoff is `current-322c8a6b1-duration-completed-handoff.json`,
SHA-256 `073057929da2d445a8ee94cea71b8a5fa608e25da7da4734392c896fecdcb5d0`.
It keeps native success and browser failure separate. Final guards verified
all 53 recorded native-run identities absent and unchanged original/copied outputs;
the numerical audit reads the completed outputs without replaying the app.

The sampler repair qualification is
`sampler-memory-evidence-20261015/qualification.json`, SHA-256
`4bf0e26ffcb6d4184460137a39e810b742a6c98e7f9ff73bbb384802ade12861`.
Its post-audit verified 51,393 inputs, unchanged staged helper bytes, absence of
all 489 recorded identities and stable raw coverage. Full input capture occurred
after child launch while committed source was held; required native/Boost/prefix
prerequisites were verified before launch. The 554 raw profiles remain unparsed
and unadmitted. The original browser refusal remains failed with its offending
operand unknown; no replacement profile is claimed by this qualification.

The later browser-duration closure is
`current-7ae10f1b0-sustained-browser/actual-tool-closure.json`, SHA-256
`61f435dd76792bbc1db84c6380a93584cf5aa0e67f5bc1a8595b11c9a4be3b94`.
It retains the rejected row and an explicit postguard metadata supplement:
verification used the armed seal, while the inherited result field still pins
the separately preserved unready seal. All 14 armed records were freshly checked;
the supplement does not rewrite the failed workload or earlier evidence.

The single RSS process observation qualification is
`current-7ae10f1b0-rss-role-diagnostic/qualification.json`, SHA-256
`c69e44d6f9464e39c11fd24db33418ab2d14bac03ad7011c9afe12fe6cf74a52`.
It preserves the failed original run, incomplete observer attribution and passing
post-audit separately. No duration or memory-growth qualification is claimed.
The maximum-workload preparation qualification is
`native-maximum-workloads-322c8a6b1/qualification.json`, SHA-256
`4cbd393da4fe20928d1aeacda58b7762ff13628afe2fae2a754d9ff86ba9c5e2`.
It pins the clean auxiliary commit and all 15 added qualification files; none is
part of the installed application closure. The driver is now integrated; the
installed application still retains its separate `322c8a6b1` source attribution.
The four installed outcomes and separate decoder-only follow-up are pinned by
`native-maximum-workloads-322c8a6b1/installed-actuals-a4e851dc3/final-handoff.json`,
SHA-256 `a3165c0e369a18fe351e3dfc844d90c0c3ef60209fa1117ba28ae8230e58c5d4`.
It retains the three scene passes, failed index PSS gate and passing movie
fidelity separately.

The lazy-audio repair qualification is
`lazy-motion-audio-output-ef1300e37/qualification.json`, SHA-256
`76373d13f69c27384ab3008b672c10fd6e54128d80de358d384ce22a1dfd58fa`.
The complete Motion Node qualification is
`current-d78e8401c-node-motion/qualification.json`, SHA-256
`5a34746b868af5bce76d9772aa28b149b54387e1a8d7592393bf6f58351c1a21`.
The focused three-engine qualification is
`current-d78e8401c-browser-preview/qualification.json`, SHA-256
`2cae280dffc63ec56827e00d23673896458ea2bdb1af71352f411deb255001e6`.
The failed duration qualification is
`current-d78e8401c-sustained-browser/qualification.json`, SHA-256
`3db28ae5fb10156509928336f30b3f7c0dc1f6b7d179a738a46b7d19e1874f7e`.
The failure remains separate from its successful cleanup/post-audit. Its Opus
reference is bounded and lossy; exact PCM is claimed only for native MOVs.

The first Conform observation is
`linked-conform-phase-execution-5c8eaa030-20261015/qualification.json`, SHA-256
`fbea8f07647c62855eeddcda6725e3ca05b20675e11376bbb23345b18ea04a98`.
The complete phase capture is
`linked-conform-phase-drain-execution-5c8eaa030-20261015/qualification.json`,
SHA-256 `c544929c39ff920b3f154ae772b26e6621039c0cbcdf91c13e98721cf84b0d08`.
Its retained timings establish a non-reproduction, not a fix or a replacement
for the failed full linked suite. The diagnostic worktree was retired normally
with both private commits and all bodies preserved; three owned worktrees remain.

The four-case observation qualification is
`four-chromium-failure-observation-7ae10f1b0-20261015/qualification.json`, SHA-256
`0061e8cd2f523c96fb50d471c83acbfa3a1797a06cbb7511914e47aea42d41cc`.
The latest complete linked-suite closure is
`current-453f03c4b-linked-preparation/actual-tool-closure.json`, SHA-256
`f1de5c97e7622557d8d10e2172071b671ac4cbadaca0e83c06d0787ed3a7d110`.
Its source/input/site guards and stable 13-profile inventory passed; raw coverage
remains unparsed and unadmitted because the suite failed. A preparation-only
external TypeScript module-format refusal is retained separately; discovery
subsequently listed exactly 39 cases before any test body ran.

The preceding passing complete Node receipt is `current-17b8a6964-node/closed.json`, SHA-256
`d9fa8b9a9f9d18f0e4d9947a30c28cb88557e9812d97987f9b2a16882a382967`.
Its post-audit is `current-17b8a6964-node/post-audit.json`, SHA-256
`15b7c1b0533f16d2f3974019b5f0ec29bc26fb5957193f94d52a3acb10f338df`.
It verified 51,372 input pins, absence of all 5,239 recorded PID/start identities
and empty root sessions, plus 5,261 stable raw profiles (13,198,215,341 bytes).
The lifetime census was sampled; it does not prove every unobserved detached
process birth. These raw profiles have not been parsed or admitted as coverage.
The preceding static receipt is `current-8cc261339-static/closed.json`, SHA-256
`a1ae50b382907f7c7d761b6d7792f3b9a43253a47b048d7dababf282334edc7e`.
The preceding complete static receipt is `current-17b8a6964-static/closed.json`, SHA-256
`9d407f85397bde43b02c38ee46f974bfb6b5cd359b768a3faaeb9bb977bff892`.
The earlier failed Node receipt is `current-3e8b3e942-node/closed.json`, SHA-256
`64ad72571cdc144cf707071bd25105b89331230d6f27d7080ed775aa5a17fda3`.
All five commands closed, source and staged helper bytes remained unchanged,
and all observed owned process identities were gone. Its static receipt is
`current-3e8b3e942-static/closed.json`, SHA-256
`696732565f03678b1cae919d7866563aca8a6c26e4c46791de565f54ddab5b08`.
The paired-download test qualification is
`transfer-sender-action-wait-3e8b3e942/qualification.json`, SHA-256
`4f06725d12cf76125ed0fa6d90ce69cbc4578b4b0a037e8686d852382a03f9f6`.
The full 45-case linked/dual-origin qualification is
`link-retention-1887abecc/qualification.json`, SHA-256
`9b5a4a88d860bbb9bf5e9741a1a0baa40eb4abed14f759b94666b4851e11af30`.
The five-workflow aggregate closure is
`current-1a788b61b-native-qualification/aggregate-recorder-command/outer-tool-closure.json`,
SHA-256 `c43cf8e6cd48d586ca1b2aa6e88b0cb6bfd64551d14f5d79bf3b6ed205ece604`.
The newer source-1202 aggregate qualification is
`current-1202edeba-native-qualification/linux-aggregate/qualification.json`,
SHA-256 `ee88688b4c5b7ac716c90c48c586daef28f63e57c11089b7d5f90fa52f7f3c5d`;
its actual tool closure and post-run audit are retained in
`current-1202edeba-native-qualification/aggregate-command/outer-tool-closure.json`,
SHA-256 `b8a597a4de2f61198c4cac38228936b70a1d5438a6fefbb0e518528cbab16126`.
Its independent completed-evidence review is
`current-1202edeba-native-qualification/aggregate-command/independent-duration-audit-final.json`,
SHA-256 `86afe81fa51e9517e7c32c134f417d10ba12de7d80911c361e942617a9e04c00`.
The new saved-kind/consumer qualification is
`early-contract-tests-17b8a6964/qualification-final.json`, SHA-256
`61d4fbcf9361f89518bd7de20ecf8fbbff3cd89074aeb89ad59fc32c7d5b3b9e`.
The focus repair qualification is
`m12-panel-focus-ownership-17b8/qualification.json`, SHA-256
`c7a947d1c7c611130928ad95b5273c7d4891b33345ef06041f5c5a0cacc210de`.
The animated-title qualification is `m06-title-animation-proof-8cc/qualification.json`,
SHA-256 `c37557c656134e72f9d82725e23500533556539cf83583c9f3761a06412a65e3`.
The graph/path repair qualification is
`graph-keyboard-repair-8cc261339/qualification.json`, SHA-256
`03fc3dfb1697cf1da33b5d928331808b2e250d67a3dba43de5bf88698cfd7ca5`.
The expression/camera qualification is
`m08-m09-expression-camera-proof-b594/qualification.json`, SHA-256
`8d07a1c1f14e7aa17b5d4142c4b6dbf9a60bb875458199a8b9b18941c3cc2b21`.
It distinguishes the final committed checks from earlier browser bytes; no new
native package run is claimed. The failed original MP4 observation is
`encoder-original-case-observation-8cc261339-selector-corrected/qualification.json`,
SHA-256 `78c3083b2e227f252aff1b4a901e0ee477fdd4b455a70d7f46cbf9ae9a53b7fa`.
The additive MP4 capture is
`encoder-additive-capture-proposal-8cc261339/qualification.json`, SHA-256
`abc0bc8c6d2d7054f6643784125e939e560e9d69566525f295b40a0c99114519`;
the independent fixed-file decode is
`encoder-fixed-file-decode-8cc261339/qualification.json`, SHA-256
`8c3625ab2ec98d1dee1654ec0797aca9509c7df0cd42452854b70413730382c4`.
The corrected two-workflow browser closure is
`video-file-color-test-repair-80f80bbbe/browser/closed.json`, SHA-256
`9de3d02036b39e125dec15b2104289c55502d38eea0c3bc42a463526c8e5ecd3`.
The M10 repair qualification is
`m10-concurrent-linked-export-b594/qualification-v2.json`, SHA-256
`4214c9bf2e7d5885acba74de62a102fe2f412d58a0f548f8a2cb9526b6b242a6`.
It retains the causal cancellation/duplicate/cleanup regressions, 68 focused
checks and 21 existing worker controls on source `5de0ab2ae`, plus 14 controls
and the three-engine browser pass on the final opaque-fixture source
`d7d694fd0`. Its fresh site evidence names that same final source.
The browser duration receipt is
`current-fa680-sustained-browser/workload/qualification-receipt.json`, SHA-256
`d7694f821c83982d65007b4852d55ab172b4fefc6539b4b9d865f9c789c45e07`;
its independent audit is `current-fa680-sustained-browser/qualification-audit.json`,
SHA-256 `9768301276c6fe9a0fc1aa3554d216af4ff2fb7b36bd69fe5186710e0278c59d`.
The native duration receipt is
`current-1202-sustained-native/workload-preserved/qualification-receipt.json`,
SHA-256 `cdf0666578f30ded1bc85d0e5f3ddce18cec1a38abd4281139db6ef08b547d05`;
its independent audit is
`current-1202-sustained-native/independent-qualification-audit.json`, SHA-256
`379771a18a310225e6e59ae1f1401366596f5a75a137763f4e6c094388453669`.
That audit preserves the raw last-scan zombie observation separately from the
later successful fresh absence check; it does not rewrite the raw ledger.
Native package custody preserves the original sandbox bytes/inodes and records
changes to historical package metadata; older packages are not silently
requalified after those changes.

The duration profile is **300 and 1,200 frames**, or ten and forty seconds at
30 fps, not 300 and 1,200 seconds. Its fixed picture, PCM, memory, timing and
cleanup requirements remain unchanged.
Earlier source `cbf09f9ea` duration attempts remain failed: the browser command
observer rejected process-stat admission, and the native observer captured only
two encoder-memory rows. The later browser pass and native failure above are
separate runs, not replacements for those historical outcomes.

## Frozen source-328 gate ledger

| Gate at source 328 | Result recorded on 2026-10-13 |
| --- | --- |
| Canonical static gate | `npm run check:static` passed, including full lint, types, audits, documentation and builds. Changed-file lint remains required for subsequent edits. |
| All exhaustive Node partitions | All five finished: 27,125 tests, 27,108 passed, 14 declared skips and three failures in common-2's nightly-payload dependency closure. Motion's 953 tests passed without skips. Full Node acceptance is failed. |
| Ordinary Chromium/Firefox/WebKit suite | Closed with exit 1: 7,536 cases, 7,207 passed, 25 failed, 303 declared skips and one unrun serial-dependent case. Chromium: 2,492 passed, three failed, 17 skipped. Firefox: 2,368 passed, nine failed, 134 skipped, one unrun. WebKit: 2,347 passed, 13 failed, 152 skipped. Full browser acceptance is failed. |
| Separate dual-origin and Motion-links suites | Canonical complete runs pending. The first linked-editor workflow subsequently passed all three engines on source `f316e407e`, including physical export and reopening after both origins closed. This is three cases, not complete suite acceptance. |
| Handbook browser suite | All 32 cases passed, without skips or retries. |
| Fresh bounded Linux packaged aggregate | Passed all nine steps and four workflow receipts for Linux x64 software rendering, with verified packages, native helper and independent decoder. This does not cover the separate authored-title failure below. |
| Browser and native controlled-duration workflows | Pending for this source. |
| Complete accepted Node/Chromium coverage union and monotone ratchets | Pending. Only the closed passing common-1 Node profiles have been strictly audited and compacted. Failed common-2 and failed ordinary browser profiles have not been admitted; no floors or ceilings were lowered. |
| Installed AE, other target/sign/install/update/hardware/maximum matrix | Open; AE environment unavailable. |

The terminal report matches all 7,536 discovered case identities and records
one attempt per case, no retries, no flaky outcomes and no global report errors.
The source and all seven site inventories remained unchanged. The omitted
Firefox case is the rehearsal-edit workflow after the serial ADR failure.
The durable `browser-ordinary/terminal-review.json` receipt has SHA-256
`71a159f8895a70cd47f1282d17738cfb8038cdf0bc7ca2e952fbd7b5a30dc526`;
its failure/skip ledger retains every original error and declared skip.

### Failures and repairs in progress

The three Chromium failures are Spreadsheet Undo after an asynchronous paste,
Contrast after attenuation, and the recording-louder guide's authored Amplify
value. The integrated Spreadsheet repair waits for the existing checkbox to
become enabled before Undo; its unchanged complete file passed 42 cases across
all three engines. The integrated Amplify repair reserves a user's draft before
late headroom analysis; its 32 focused Node checks and both original workflows
passed across all three engines. These focused passes do not replace the failed
source-328 results or establish acceptance of the combined implementation.

The three common-2 failures come from the sustained-browser verifier importing
the entire host workload into the portable nightly payload. A separate repair
extracts the reference verifier and stages its four actual dependencies. The
original failing assertions and new omission tests pass on the integrated
repair. These focused results do not make the original full-suite failures
successful. The frozen source-328 browser capture remains unchanged.

The integrated rack-dialog repair mounts the header with its loaded parameter
controls, preventing the demonstrated Close-target movement during loading.
Both loading regressions and the original Radio/ADR workflows passed all three
engines; the unchanged resize workflow also passed in a separate follow-up.
The original full-run failures remain recorded.

Five direct GPU checks now require an independent native host witness. Their
original comparisons passed in Chromium and WebKit; Firefox's absent WebGL2
produces five explicit qualification skips. CPU fallback checks remain intact;
these skips do not prove Firefox GPU fidelity. The real-audio readiness check
now observes a live analyser/clock/playing tuple in-page within the original
five-second deadline. A failed diagnostic captured loud intervals missed by
cross-process polling. The unchanged one-second playback, signal, queue and
pause assertions passed all three engines after this observation repair.

The frozen full run also exposed Punch recording, short-import playback and
post-workspace-switch tempo failures. Bounded unchanged-workflow diagnostics
passed the latter two categories but did not establish their original causes.
They remain unresolved; no timing or signal bounds were relaxed.

WebKit's remaining failures also include three live-effect continuity cases,
musical-number tempo editing, a disabled Select menu and a return-to-home
navigation timeout. The annotation workflow reached and closed
the read-only Frame view; its timeout occurred during the subsequent Sound
home navigation, before checking reopened annotations. These failures remain
open. The integrated search repair cancels stale opening and restoration focus
frames on activation or unmount. Its causal mounted-component controls fail on
the old implementation and pass normally and in StrictMode after repair. The
unchanged search workflows and cold effect-dialog controls passed 36 cases
across all three engines on source `d8dbe9a4c`; these focused results do not
close full browser acceptance. Integration also fixes the rack dialog's chunk
ownership and extracts shared video transfer functions without changing their
numerical formulas.

A paired capture of the original three WebKit live-effect workflows passed
their ScriptProcessor assertions on frozen source 328. Its independent native
observer nevertheless found a 26.12 ms near-silent EQ interval inside the
post-edit window. Both observers used the same live output; native input and
frame continuity guards passed. A read-only audit found no persistent EQ
history reset. Synchronous audio-thread coefficient rebuilding and upstream
chunk starvation remain possible causes. The passing ScriptProcessor checks
therefore do not qualify native continuity or resolve the original failures.
The first prepared additive observer was refused before execution because it
selected the final destination instead of the intermediate two-input join.
A corrected preparation retained the original 53 controls and passed 71 added
controls, with 286 input pins and independent review. Its single actual WebKit
diagnostic closed failed: the original test body passed, but diagnostic admission
found the injected selector missing and no additive observer. Source/site guards
and process closure passed. This instrumentation failure provides no causal
evidence for the historical gap; callback coverage and the cause remain open.
Its terminal receipt is
`webkit-eq-mixed-join-328cae02f-cpu12-15/run/closed.json`, SHA-256
`e66d777bde5238923c1d05151d80ad3eaad19c5012caa9b127916f2146a7ca0a`.
The installed Playwright wrapper made that selector lexical; consuming the
same lexical binding fixed the external injector. Three old-source controls
failed and all 74 corrected pure controls passed before one new actual run.
That run passed its original body and complete diagnostic admission: 371
128-frame quanta over frames 21,248–68,736 and the actual intermediate join
showed no upstream, EQ, additive, downstream or cancellation loss. Independent
recomputation and custody/cleanup checks passed. This is **non-reproduction**;
the worklet cost clock was unavailable, so cost and historical causation remain
unqualified. The completed review is
`eq-lexical-completed-independent-audit-20261015/audit.json`, SHA-256
`52fb326a79c50a79113825cf9cac39ce23c80e1ed03491b28fc5d049be3c2a87`.

Supplemental M10 execution reached actual connection, update, Undo/Resume,
Conform, portable Save/Open and matching blue preview in Firefox. Delivered MP4
pixels exceeded the unchanged green-channel limit. Inspection found BT.601
planes declared as BT.709. The integrated finishing conversion now produces
explicit limited-range BT.709 planes. Firefox passed the original full case;
WebKit media initialization was separately diagnosed and repaired, and its real
delivery passed the color check before a later offline failure. Chromium's
correct 709 file exposed a separate native canvas conversion approximation.
An independent file oracle with retained absolute presentation measurements is
being qualified; the original HTML-pixel failure is not relabeled successful.
Offline reopening also required avoiding an unused portable-recovery import.
That key-only custody admission repair is integrated, with present/corrupt and
cancelled custody checks preserved. The first complete linked-editor workflow
now passes in Chromium, Firefox and WebKit on source `f316e407e`, with no
retries, skips or errors. Each engine verified 121 current-release cache bodies,
including eight used fonts, against the manifest and actual built bytes. Both
owned origins then closed before reopening the same stored owner with a ready
editor, blue preview, matching link digest and no page errors. All 1,415 site
and source-map files remained unchanged. The receipt is
`video-color-repair/used-assets-dotted-original/qualification.json`, SHA-256
`e7b4d1509a37df5015bddb52cad11e2716066c03ba24d1c7ef3fa8fa4106fcfc`.

The integrated delivery repair completes missing color signaling only for the
encoder's own limited-range BT.709 AVC output. Bounded native configuration
repairs preserve picture bytes and timing and leave the general metadata
parser strict. The offline repair replays the observed completed asset set
through the current worker; it does not claim complete historical inventory or
general persistence. The workflow separately proves its actual cache custody.
Chromium's absolute native/HTML blue value remains 241; its normative decoded
file planes satisfy the unchanged twelve-code bound and match an independent
same-plane presentation control. Firefox's BGRX native output satisfies that
bound but does not qualify normative YUV-plane decoding. Earlier absolute
presentation failures remain recorded. Complete linked and dual-origin suites
on the combined implementation remain pending.

The supplemental M05 desktop workflow completed real New Composition, shape/text
authoring, Save, preview, cancellation and retry, and produced a ProRes 4444 MOV.
Its strict color check failed: 9.83 ten-bit code values versus the unchanged limit
of eight, at two text-edge channels across two frames. Alpha was exact. Encoding
the retained CPU reference produced identical movie and decoded bytes. A
precodec conversion stayed within the bound. The integrated native quality
repair passed all five native CTests and a fresh maintained helper/reference
replay of the retained authored input, with a maximum 3.93-code error against
the same eight-code limit. Those receipts remain bound to source `f66040509`,
not the newer combined implementation. They do not establish a new packaged
GUI result.
The maintained authored-title workflow checks exact saved menu intent and
decoder/CanvasKit byte authority; its initial 14 focused checks passed before
fresh native execution. The later source-9173 standalone success is recorded
above. Menu execution and the earlier small-scene aggregate did not close the
failed authored-title gate; the required combined aggregate and duration gates
remain separate. Normal native reuse verification
and a fresh maintained reference-decoder build/verification passed on clean
source `a92368082`; all seven prefix trees and 172 files remained unchanged.
The native receipt retains its original `f66040509` identity. These phases did
not stage or package a desktop application, run the GUI or change its sandbox.

Integration preserves each original repair commit in Git ancestry. Finished
auxiliary worktrees are removed after preservation. The obsolete source-328
checkout was removed with normal Git commands after verifying all 19,229 tracked
source files and preserving 62,012 generated files (13,559,200,803 bytes),
including all sixteen historical sandbox inodes. The merged M10 auxiliary was
also removed normally after preserving its 19,306 source files, generated bodies
and symlinks. Five owned worktrees remain.
The retirement receipt is
`frozen-328-retirement-execution-v3-20261015/actual-tool-closure.json`, SHA-256
`20e3e8ac7be948095b5c048f70c9fdfb3573676f36cde3c38f7ae6042f5e69d3`.
The M10 auxiliary retirement is
`m10-concurrent-export-retirement-20261015/actual-tool-closure-v2.json`, SHA-256
`03d24d9b57061ab6ce768f166f73a7d78a211b4bbab3a5d25f0b93bf853146f7`.
Old absolute paths and workspace symlinks are historical; raw coverage remains
unadmitted. Held current package and ordinary-suite inputs are unchanged.
No source, dependency,
site or packaged bytes used by the completed frozen capture were changed.

The merged authored-chooser auxiliary at source `1202edeba` and its branch were
removed normally after its source, staged bodies and unique ignored file were
preserved. All 32,077 installed-file counterparts and both current sandbox
helpers remained unchanged. Its receipt is
`authored-chooser-retirement-1202-20261015/retirement-final/retired.json`, SHA-256
`b37f84bec66f320d0eb919dbbf15b9fd3326672476abbf1d4cbf75dbb317e0bd`.
The later mixed-preview and old ordinary auxiliaries were also removed normally,
with their source, generated bodies and unique caches retained. Their receipts are
`mixed-preview-poll-interval-fix-322c8a6b1/retirement-final/retired.json`, SHA-256
`1c8e8a4ccd5a12603f61f7df3d6a1f5561c9462a08a85b315ad150b401d8be07`, and
`ordinary-current-retirement-3e8b3e942-20261015/retirement-final/retired.json`, SHA-256
`43160ca807c2287313137c64b31be4680d876b35bd25f0cbdbf493d435d87b46`.
The remaining active worktrees retain their own held inputs and outputs.

The retained evidence includes `gates/static-result.json`, all five
`node/*-result.json` files, the handbook result, and
`native/linux-qualification-review.json`. The native aggregate digest is
`4fdb6f5fbaa2d5bfca7afc857ef5fd6f5ec6dee7ee8ccd1866a0db4d3ce6c883`.
The static log digest is
`3effb9ef8aaba6577e5c758ac4c720687dec6e8ce2581611e26223deb489eb61`.

## Historical reports, not recovered proof

The conversation recorded the following outcomes on 2026-10-12 for
`c80ac57f384318f3284851abda461cacb6f629d8`. Their temporary files are now lost;
these rows preserve history only and must not be presented as accepted current
source-bound evidence.

| Historical c80 activity | Reported outcome before evidence loss |
| --- | --- |
| Full static | Reported successful. |
| Five Node partitions | Reported 27,125 tests: 27,111 passed, 14 declared skips, zero failures. The lost skip ledger cannot be reconstructed from totals. |
| Handbook browser suite | Reported 32 unique cases passed once, without skips or retries. |
| Bounded software Linux x64 packaged aggregate | Reported all nine steps and four required workflow receipts successful. |
| Controlled native duration | Reported 300/1,200-frame 160×90 software preview/ProRes/PCM, references and actual cancellation/retry within predeclared bounds. |
| Controlled Chromium duration | Failed after physical 300-frame PNG/WebM output, during the post-export WebM verifier loader. The 1,200-frame phase did not run; no duration qualification was produced. |
| Full ordinary/supplementary browser and coverage union | No complete accepted result recorded. |

The browser failure was in the maintained verifier's global exposure after
loading an esbuild IIFE through `page.evaluate`. Current source uses
`page.addScriptTag` before calling the verifier. That implemented correction and
its earlier focused report are not a substitute for a new complete workload.
Earlier e44 documentation-discovery and CDP startup failures, the subsequent
bounded one-frame diagnostic, and their repairs were also recorded historically.
They must not be converted into successful full-workload or release claims.

The committed [Linux qualification page](motionscaper-linux-ci-qualification.md)
retains older source-attributed hashes and small-scene measurements. Those are
historical text; receipts are missing and generated bytes were not reverified.
Do not recreate old receipt JSON with invented process identities or label a
new package with an old successful revision.

## Capability and external limits

- The [AE bridge](motionscaper-after-effects-bridge.md) has a documented editable
  subset, not general project or plug-in compatibility. Scalar opacity expression
  translation is opt-in; untrusted declarations do not authorize execution.
  Text, shape, scene and Gaussian mappings require their reviewed metadata and
  profiles. No installed-AE version, frame parity or reimport is qualified.
- Editable Motion-to-AE exchange is muted/video-only. Complete rendered transfer
  covers at most 256 frames of one composition as 8-bit straight-alpha sRGB PNG,
  omits transferred audio, and retains `original.mscape`. Unsupported arbitrary
  projects are not guaranteed an editable-or-baked transfer within these bounds.
- [Direct AEP research](motionscaper-aep-native-format-research.md) reviewed
  Storytold and external candidates; no candidate dependency was adopted or run
  as a native project importer here. Direct parsing/native AE plug-in hosting
  remain separate feasibility work, not a hidden release claim.
- The historical ephemeral Linux WebKit host refused native video encoding and
  lacked credentialless isolation. Policy-preserving link transfer cannot be
  called actual COI there. Larger original archive copies require a streaming
  picker or persistent temporary storage; absence is a visible pre-read refusal.
  These are specific host/capability observations, not general Safari claims.
- Bounded software Linux and one fixed duration profile do not qualify hardware
  GPUs, maximum scene combinations, macOS Safari, other OS/architectures, signed
  installers, file associations or real installed update behavior. The configured
  workflows and finite admission limits do not supply missing execution results.

No installed AE environment is available; no further request is needed. That
explicit M11 gate also keeps the M12 public-release gate open even if all locally
runnable checks later pass. Fresh results should replace only the current gate
ledger with their actual evidence, preserving failed/history attribution and the
qualified source revision after any documentation-only descendant.

This documentation changes no assistance runtime or its target asset inventory.
No manual **Update AI assets** run is required.
