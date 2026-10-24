# Editor performance

Loading, timeline rendering, audio processing, and project publication have
separate scaling constraints. Profile the affected workflow with representative
project sizes, channel counts, and storage backends before extending an
optimization. The [quality diagnostics](quality-diagnostics.md) guide owns
performance observations and correctness thresholds; build and coverage
budgets remain in their machine-readable registers.

## Scaling contracts

| Area | Contract | Focused regressions |
| --- | --- | --- |
| Timeline queries | Reuse indexes for immutable documents and keep repeated viewport queries proportional to visible content. Include index construction in measurements. | [Clip windows](../../tests/audio-editor-timeline-viewport-index.test.ts), [duration](../../tests/audio-editor-timeline-viewport-duration.test.tsx), [snapping](../../tests/audio-editor-boundary-snap.test.ts) |
| Label geometry | Reuse weakly owned immutable ordering and bounded text measurements; calculate track heights without full presentation maps. Font completion invalidates both heights and visible rows; retired project records remain collectible. | [Layout work](../../tests/audio-editor-label-layout-performance.test.ts), [font publication](../../tests/audio-editor-label-layout-react.test.tsx) |
| Video overlap presentation | Bound retained pair geometry and use viewport-only generation for dense overlaps. Preserve visible pairs and invalid clip IDs. | [Overlap presentation](../../tests/audio-editor-video-overlap-presentation.test.ts) |
| DSP | Share channel-independent work while preserving PCM, rounding, telemetry, and state across chunks. Retained history owns its buffers; transferred packets must not expose borrowed storage. | [Sinc kernels](../../tests/audio-editor-streaming-resample-kernel.test.ts), [frequency peaks](../../tests/audio-editor-frequency-waveform-band-peaks.test.ts), [live dynamics](../../tests/audio-editor-live-dynamics-gain-work.test.ts), [borrowed input](../../tests/audio-editor-resample-borrowed-input.test.ts) |
| Playback meters | Sample visible or armed strips and retain master analysis. Reuse production channel measurements for scalar presentation, with fallback for missing or pending channel results. Headless consumers retain full metering. | [Demand and fallback](../../tests/audio-editor-playback-meter-demand.test.ts), [visibility leases](../../tests/audio-editor-playback-meter-visibility.test.tsx) |
| Retention and autosave | Update retention roots incrementally. Coalesce superseded queued saves while preserving explicit flushes, project switches, dirty state, rollback, and retry after failure. | [Retention](../../tests/audio-editor-session-retention-index.test.ts), [autosave queue](../../tests/audio-editor-autosave-queue-performance.test.ts), [memory publication](../../tests/audio-editor-project-memory-publication-performance.test.ts) |
| Publication equality | Compare canonical tokens without reconstructing full encoded project trees. Preserve serializer ordering, binary bytes, validation, and ordinary JSON hooks. | [CAS parity and work](../../tests/audio-editor-project-cas-equality-performance.test.ts) |
| Revision pruning | Use scalar keys for canonical revisions, accept historical key formats, retain the current document, and keep requests inside their IndexedDB transaction. | [Pruning](../../tests/audio-editor-project-revision-pruning-performance.test.ts), [browser publication](../../tests/browser/audio-editor-storage-publication.spec.js) |
| Command preparation | Reuse privately owned immutable projections and invocation-local indexes. Preserve authored order, duplicate-reference authority, validation, and missing-reference errors. Arbitrary mutable inputs retain uncached admission. | [Project Bin](../../tests/audio-editor-command-project-bin-performance.test.ts), [paste collisions](../../tests/audio-editor-paste-existing-clip-index.test.ts), [snapshot equality](../../tests/audio-editor-project-snapshot-equality.test.ts) |
| Command and media search | Normalize owned search text lazily, bounded to 16,384 entries and 4,194,304 characters per prepared batch. Reuse unchanged media inventories across menu refreshes; excess and mutable entries retain uncached scoring. | [Search preparation](../../tests/audio-editor-search-preparation.test.tsx) |
| Startup | Keep optional UI and processing engines in their deferred feature owners. Batch independent settings reads while preserving fallback and disposal behavior. | [Deferred ownership](../../tests/audio-editor-deferred-startup-ownership.test.ts), [bootstrap](../../tests/audio-editor-project-bootstrap-concurrency.test.ts), [browser loading](../../tests/browser/editor-startup-progress.spec.js) |

Further optimizations must preserve the [editing performance boundaries](editing-performance-opportunities.md).
[Smaller candidates](performance-candidates.md) need current profiles before
implementation.

## Runtime work regressions

These probes exercise the named production paths with representative fixtures.
Counts measure the work in each fixture; wall-clock gains depend on the project
and host. The paired tests preserve audio, ordering, ownership, and publication
behavior alongside the reduced work.

| Area | Fixture and observed work | Regression |
| --- | --- | --- |
| Clipboard paste destinations | 600 tracks: 541,500 to 1,800 destination type reads. | [Paste indexes](../../tests/audio-editor-runtime-paste-target-index.test.ts) |
| Spreadsheet source references | 120 name edits across 400 sources: 96,000 to 400 name reads. | [Source names](../../tests/audio-editor-runtime-spreadsheet-source-index.test.ts) |
| Action availability | 400 selected tracks: 161,201 to 800 ID reads. Small selections retain short-circuit scans. | [Selection facts](../../tests/audio-editor-runtime-action-selection-index.test.ts) |
| History admission | 200 snapshots with 1,100 clips each: 440,000 to 220,000 clip reads, with no duplicate retained root Sets. | [Paired roots](../../tests/audio-editor-runtime10-retention-admission.test.ts) |
| Recording previews | 32 late visible rows among 512 recording tracks: 15,888 to 512 preview ID reads. | [Recording rows](../../tests/audio-editor-runtime-recording-preview-index.test.tsx) |
| Row viewport queries | 100 unchanged publications over 10,000 clips: 100 to zero repeated result sorts; visual state is still freshly polled. | [Viewport reuse](../../tests/audio-editor-runtime-row-viewport-reuse.test.ts) |
| Envelope presentation | 101 selection refreshes over 2,048 points: 206,848 to 2,048 dB conversions. Mutable inputs retain fresh projection. | [Envelope projection](../../tests/audio-editor-runtime-envelope-projection.test.ts) |
| Repair interpolation | Production-sized damaged span: 592 to 3 scratch allocations; 590 to 178 contributing equation rows. | [Repair scratch](../../tests/audio-editor-runtime10-repair-scratch.test.ts) |
| Automation scheduling | An admitted absolute curve: 294 to 147 curve probes by reusing preflight events. Mutable scheduling inputs retain fresh admission. | [Automation preflight](../../tests/audio-editor-runtime10-automation-preflight.test.ts) |
| Live loudness history | At 6,000 entries: eliminate 5,999 shifted references per new reading while retaining one contiguous snapshot copy. | [Production history](../../tests/audio-editor-runtime10-live-loudness-history.test.ts) |

Editing indexes live only for their invocation. Row queries retain one current
visible result, recording views retain one current preview index, and history
projections share private Sets under weak document ownership. Automation reuse
retains at most 16,384 preflight events per scheduling invocation. Envelope reuse is
bounded per waveform-cache owner to 256 entries and 65,536 combined input/output
points, with weak input ownership. The mirrored loudness ring adds at most
48 KiB of references at its production capacity. Explicit-GC regressions check
that retired project and envelope metadata is collectible.

## Measurement and reproduction

Use Node.js 26.5.0 and npm 12.0.1. Begin with a failing behavior or operation-count
regression for the suspected cost, establish audio/pixel/ownership parity, then
compare timings with the same host, fixture, preference, warm-up, and repetition
count. Keep setup outside timed intervals and report preparation separately
from repeated queries.

Run the relevant committed regressions from the repository root, for example:

```sh
node --import tsx --import ./scripts/node-style-asset-loader.mjs --test tests/audio-editor-timeline-viewport-index.test.ts tests/audio-editor-video-overlap-presentation.test.ts
node --import tsx --import ./scripts/node-style-asset-loader.mjs --test tests/audio-editor-streaming-resample-kernel.test.ts tests/audio-editor-frequency-waveform-band-peaks.test.ts tests/audio-editor-live-dynamics-gain-work.test.ts
```

For paired kernel measurements, prepare isolated baseline and current checkouts.
Record the exact revisions, source hashes, fixture geometry, and any source or
build overlays. A recorded HEAD alone cannot reproduce uncommitted source
variants. Each bundle must resolve production modules and ownership brands
inside its own checkout; both roots need the shared fixture factory required
by the harness. Restore historical variants from Git deliberately when needed.

```sh
node --import tsx scripts/performance/measure-editing-responsiveness-round4.ts /path/to/baseline /path/to/current test-results/performance/editing.json
node --import tsx scripts/performance/measure-responsiveness-round4.ts /path/to/baseline /path/to/current test-results/performance/runtime.json
node --import tsx scripts/performance/measure-dsp-responsiveness-round4.ts /path/to/baseline /path/to/current test-results/performance/dsp.json
```

These tools check parity outside timers and record alternating raw trials.
Kernel and operation-count probes measure their named work; measure storage,
worker startup, React publication, and first useful feedback separately when
assessing a complete editor operation. Some older prototype probes assert a
historical source pattern; update their fixtures deliberately when that
mechanism changes. Use explicit garbage collection for retained-heap comparisons.

For Electron interaction measurements, stage a fresh app under
`.desktop-build/app` using the [desktop build workflow](../operations/release.md).
The harness creates an isolated profile, checks the default Speed preference
through the existing menu, and observes real canvas painting and playback.

```sh
xvfb-run -a node --import tsx scripts/performance/measure-electron-editing.mjs test-results/performance/electron.json --round4
```

Record runtime versions, viewport/DPR, storage backend, host load, rendering
backend, and whether a run includes first-use engine preparation. Compare total
completion with renderer long tasks and frame gaps. Xvfb animation-frame
intervals describe renderer scheduling; GPU presentation and real-model
inference need representative hardware and models. Local production previews
also cannot establish field network latency or production cache behavior.
Keep each original failed run and its separate retry distinguishable in the
change's review evidence. Store generated output under `test-results/`.

## Correctness and guardrails

Keep semantic chunk groups, the 500,000-byte production JavaScript chunk ceiling,
startup graph budgets, coverage floors, and source-file size ratchets. Read
current graph costs from each build's `.startup-graph-report.json`; earlier
measurements do not describe the current bundle. Optional features enter through
menus and load with their owning feature.

Run checks appropriate to the affected owners: changed lint, focused numerical
or ownership regressions, the canonical non-browser gate, and browser workflows
for interactive changes. Evaluate coverage floors over the required union of
Node and Chromium evidence. Reassess the manual **Update AI assets** requirement
when a proposed optimization changes the generated assistance runtime closure
or target file inventory.
