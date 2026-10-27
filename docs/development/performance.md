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

## Runtime ownership and bounds

Operation-count regressions exercise their named production paths alongside
ordering, mutation, cancellation, and output parity. Their fixture counts do
not establish an end-to-end speedup. Completed optimization inventories and
before/after measurements are available in Git history.

### Editing and presentation

Editing indexes belong to one invocation, view, or immutable owner. Identity
admission preserves the original first or last duplicate authority. Mutable
records, accessors, sparse arrays, and custom traversal retain live-read paths;
small selections retain short-circuit traversal before index admission.
History projections share private Sets under weak document ownership.

Row readers retain one current visual result and still poll mutable visual
providers. Recording views retain one current preview index. Preview windows
box native peak views directly into detached number arrays; custom iterators,
species, accessors, and shared buffers retain the original slicing path.
Matrix edits share only frozen rows; mutable matrices produce independent
copies. Meter equality preserves fresh publications and scalar polling.

Custom action and symbol search retain at most 16,384 entries and 4,194,304
derived characters for the current view. Keyboard presentation is bounded to
16,384 bindings. Strip publication lookup admits at most 128 strips and keeps
one weak owner. Explicit-GC regressions check that retired UI inventories and
meter publications remain collectible.

Split-tool caches share a 65,536-entry/point and 64-record limit, retain only the
latest boundary tuple per clip-array owner, and hold owners weakly. Oversize
and mutable inputs retain linear fallback algorithms. The
[split-tool cache regressions](../../tests/audio-editor-runtime50-ui-cache-budget.test.ts)
check retired clip metadata, tuple owners, and replaced boundary arrays.

### Audio processing

Automation reuse retains at most 16,384 preflight events per scheduling
invocation. Envelope reuse is bounded per waveform-cache owner to 256 entries
and 65,536 combined input/output points, with weak input ownership. The mirrored
loudness ring adds at most 48 KiB of references at its production capacity.

Weak analyser owners retain 16 KiB of meter-merge scratch or 8 KiB of EQ scratch
per active input/output bank (16 KiB for both EQ banks). Live click/noise PCM
rings are bounded by channel and processing-window geometry rather than
recording duration. DSP regressions compare Float32 output digests, block
partitions, resets, link changes, aliases, and signed-zero behavior.

STFT and inverse STFT reuse two 2,048-element Float64 scratch planes (32 KiB)
per invocation/channel, alongside a 16 KiB window. The impulse generator keeps
per-channel seeds and references without an impulse-sized envelope buffer.
Streaming TIGER overlap preserves ring buffers and processing order and uses
at most 192 temporary output references during emission, with no added PCM
storage. Convolution reuses its existing storage and clears only the unfilled
suffix. The [Fourier](../../tests/audio-editor-runtime100-audio-fourier.test.ts)
and [streaming overlap](../../tests/audio-editor-runtime100-audio-streaming-overlap.test.ts)
regressions cover scratch reuse and output parity.

### Storage and interchange

Command indexes and export partitions belong to one operation or snapshot
session. Export maps retain identities and lane references, never copied PCM;
the Audacity source normalizer retains no PCM. The DAWproject width reader
reuses maps the export already owns. Metadata lookup retains at most eight
requested keys. XML indentation reuse retains at most 65 strings and 4,160
characters per serialization; deeper nesting uses the original calculation.

The AUP4 overlap index activates only for sustained wide overlap. Its active
and free numeric heap entries together are bounded by the allocated lane
count minus the first eight linearly queried lanes. Sparse and short dense
preludes use the previous kernel; invalid or custom inputs preserve historical
traversal. [Randomized fixtures and an exact public export-plan digest](../../tests/audio-editor-runtime100-aup4-overlap-lanes.test.ts)
check lane assignment. Time the complete admitted lane kernel over sparse and
mixed projects; public plan probe counts alone do not predict export latency.

Memory repositories preserve inventory membership snapshots, clone ownership,
mutation/error order, and asynchronous chunk-yield behavior. Temporary cleanup
reads scalar protection roots without cloning encoded assets. Pruning builds
only a temporary token-to-string-key partition. Scape witness clustering
compacts private arrays in place and keeps its structural witness byte ceiling.
The fitting-cache shortcut follows complete account validation and safe byte
summation; expiry and pressure retain their original ordering. The
[storage selection regressions](../../tests/audio-editor-runtime100-storage-selection.test.ts)
cover membership, ownership, and mutation/error order.

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
change's review evidence. Store generated output under `test-results/` and
work logs under ignored `private/`.

## Correctness and guardrails

Keep semantic chunk groups, the 500,000-byte production JavaScript chunk ceiling,
startup graph budgets, coverage floors, and source-file size ratchets. Read
current graph costs from each build's `.startup-graph-report.json`; earlier
measurements do not describe the current bundle. Optional features enter through
menus and load with their owning feature.

Use the [testing guide](testing.md) to select changed lint, focused numerical
or ownership regressions, and browser workflows for interactive changes. Agents
hand off the full gates with their worktree path. Evaluate coverage floors over
the required union of Node and Chromium evidence. Reassess the manual
**Update AI assets** requirement when a proposed optimization changes the generated assistance runtime closure
or target file inventory.
