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

## Further runtime work reductions

These 50 additional changes reduce work in active editing, playback, analysis,
processing, storage and export paths. Their public-path regression fixtures
measure the operations listed below, alongside ordering, mutation, cancellation
and output parity. Counts describe those fixtures, not an end-to-end timing
claim. Loading work is excluded.

| ID | Operation | Observed work in the regression | Regression |
| --- | --- | --- | --- |
| A01 | Zero-crossing search | 329 to 246 conversions; 41 candidate arrays to zero | [Test](../../tests/audio-editor-runtime50-audio-primitives.test.ts) |
| A02 | Streaming stereo analysis | 800 to 600 conversions per 100 frames | [Test](../../tests/audio-editor-runtime50-audio-primitives.test.ts) |
| A03 | Stereo vocoder | 81,920 unused oscillator writes to zero; 7,680 fewer state bytes | [Test](../../tests/audio-editor-runtime50-dsp.test.ts) |
| A04 | Linked surround noise gate | 1,024 to 128 attack calculations per 128 frames | [Test](../../tests/audio-editor-runtime50-dsp.test.ts) |
| A05 | Unchanged frequency audition | Four replacement filters to zero per unchanged range setter | [Test](../../tests/audio-editor-runtime50-audio-graphs.test.ts) |
| A06 | Parallel channel routes | 16 to four matrix lookups for a sparse 4×4 route | [Test](../../tests/audio-editor-runtime50-audio-graphs.test.ts) |
| A07 | Strip meter reconciliation | One temporary record to zero per strip/tick | [Test](../../tests/audio-editor-runtime50-audio-primitives.test.ts) |
| A08 | Multichannel meter spectrum | 2,173 to 2,047 logarithmic merges per tick | [Test](../../tests/audio-editor-runtime50-audio-graphs.test.ts) |
| A09 | Project duration | Two to one clip traversals; no flattened clip array | [Test](../../tests/audio-editor-runtime50-audio-primitives.test.ts) |
| A10 | EQ spectrum scratch | Eight to one scratch buffers on the first eight-channel read; zero fresh buffers thereafter | [Test](../../tests/audio-editor-runtime50-audio-primitives.test.ts) |
| A11 | Selection latency flush | 18 to four scratch clears in an 8,333-frame flush | [Test](../../tests/audio-editor-runtime50-dsp.test.ts) |
| A12 | Parallel integer delay | Six to one geometry reads per five-frame block; no per-frame remainder | [Test](../../tests/audio-editor-runtime50-audio-primitives.test.ts) |
| A13 | Live click removal | 42,000 boxed PCM pushes to zero | [Test](../../tests/audio-editor-runtime50-dsp.test.ts) |
| A14 | Live noise reduction | 36,315 to 315 numeric array pushes; no PCM prefix splices | [Test](../../tests/audio-editor-runtime50-dsp.test.ts) |
| A15 | Compressor telemetry | 347 to 128 transformed-envelope reads per 128 frames | [Test](../../tests/audio-editor-runtime50-dsp.test.ts) |
| E01 | Keyboard focused-track toggle membership | 20,303 to 0 native includes indexed element reads | [Test](../../tests/audio-editor-runtime50-editing-e01.test.ts) |
| E02 | Validate selected labels after project mutation/snapshot | 400 to 0 unrelated label-catalog getter reads | [Test](../../tests/audio-editor-runtime50-editing-e02.test.ts) |
| E03 | Resolve label paste target | 200 to 0 later track type getter reads | [Test](../../tests/audio-editor-runtime50-editing-e03.test.ts) |
| E04 | Take clipboard source-track ownership admission | 10,000 to 100 sourceTrackId property reads | [Test](../../tests/audio-editor-runtime50-editing-e04.test.ts) |
| E05 | Normalize take clipboard comp regions | 7,261 to 1 Array.find predicate visits | [Test](../../tests/audio-editor-runtime50-editing-e05.test.ts) |
| E06 | Derive copied sidechain routes | 20,100 to 200 copy sourceTrackId reads | [Test](../../tests/audio-editor-runtime50-editing-e06.test.ts) |
| E07 | Preserve production routing when deriving tracks | 8,015 to 560 Array.find predicate visits | [Test](../../tests/audio-editor-runtime50-editing-e07.test.ts) |
| E08 | Restore surviving folder bus VCA state | 5,250 to 200 Array.find predicate visits | [Test](../../tests/audio-editor-runtime50-editing-e08.test.ts) |
| E09 | Copy route automation for derived edges | 10,100 to 200 copy sourceEdgeId reads | [Test](../../tests/audio-editor-runtime50-editing-e09.test.ts) |
| E10 | Remove tracks and clean their detector references | 64,122 to 83 Array.filter predicate visits | [Test](../../tests/audio-editor-runtime50-editing-e10.test.ts) |
| E11 | Copy/cut a selected-label batch | 5,250 to 200 label identity getter reads | [Test](../../tests/audio-editor-runtime50-editing-e11.test.ts) |
| E12 | Duplicate authored ADM strip assignments | 10,000 to 0 Array.filter predicate visits | [Test](../../tests/audio-editor-runtime50-editing-e12.test.ts) |
| E13 | Admit punch transition cut range | 204 to 0 Array.filter predicate visits | [Test](../../tests/audio-editor-runtime50-editing-e13.test.ts) |
| E14 | Resolve sequence-scoped peer-track membership | 6,400 to 0 Array.filter predicate visits | [Test](../../tests/audio-editor-runtime50-editing-e14.test.ts) |
| E15 | Place a derived track beside its source | 298 to 0 native slice copied element reads | [Test](../../tests/audio-editor-runtime50-editing-e15.test.ts) |
| U01 | Resolve mixer strip pan widths once | 206 to one source ID read for 100 tracks and 101 strips, including gesture effect publication | [Test](../../tests/audio-editor-runtime50-ui-mixer.test.tsx) |
| U02 | Index mixer send parameter addresses | 30,300 to zero original graph-edge reads while rendering 100 send controls, including effect publication | [Test](../../tests/audio-editor-runtime50-ui-mixer.test.tsx) |
| U03 | Normalize and partition mixer routing once | 20,100 to 201 normalization descriptor reads for 201 graph edges projected onto 100 tracks | [Test](../../tests/audio-editor-runtime50-ui-mixer.test.tsx) |
| U04 | Build menu media lookup once | 10,000 to 100 clip ID reads for 100 tracks; source ID reads fall from 100 to one | [Test](../../tests/audio-editor-runtime50-ui-indexes.test.ts) |
| U05 | Stop unnecessary mono partner discovery | 200 to zero partner type reads across stereo-track and audio-disabled menus with 100 partners | [Test](../../tests/audio-editor-runtime50-ui-indexes.test.ts) |
| U06 | Index folder roving tab focus | 40,400 to 600 folder ID reads when rendering 200 rows with the last folder active | [Test](../../tests/audio-editor-runtime50-ui-indexes.test.ts) |
| U07 | Reuse visible folder keyboard order | 20,000 to 200 row visibility reads for 100 ArrowDown events over 200 folders | [Test](../../tests/audio-editor-runtime50-ui-indexes.test.ts) |
| U08 | Index split hover snap boundaries | 30,000 to 500 clip start-frame reads for 30 hovers over 500 clips | [Test](../../tests/audio-editor-runtime50-ui-indexes.test.ts) |
| U09 | Index split clip hit testing | 29,970 to 500 clip identity reads for 30 hit tests over 500 frozen clips | [Test](../../tests/audio-editor-runtime50-ui-indexes.test.ts) |
| U10 | Allocate visual revision only when content changes | 3,000 to zero nine-field scratch pushes across 30 unchanged polls of 100 clips; all 3,100 visual getter polls still occur | [Test](../../tests/audio-editor-runtime50-ui-allocation.test.tsx) |
| U11 | Avoid unchanged selection intersection Sets | 90 to zero new Set allocations across 30 unchanged row reads | [Test](../../tests/audio-editor-runtime50-ui-allocation.test.tsx) |
| U12 | Share spreadsheet column descriptors by row shape | 500 to one pitch-label read and descriptor array for 500 identical editable rows with 13 columns each | [Test](../../tests/audio-editor-runtime50-ui-allocation.test.tsx) |
| U13 | Find removed track focus survivor in linear work | 59,902 to 202 survivor dataset reads after removing the first 200 of 400 rows | [Test](../../tests/audio-editor-runtime50-ui-focus.test.ts) |
| U14 | Find removed label focus survivor in linear work | 59,900 to 200 survivor label dataset reads after removing the first 200 of 400 labels | [Test](../../tests/audio-editor-runtime50-ui-focus.test.ts) |
| U15 | Find removed clip focus survivor by current-node membership | 200 to zero linear Array.includes scans after removing the first 200 of 400 clips | [Test](../../tests/audio-editor-runtime50-ui-focus.test.ts) |
| R01 | Scape provisional publication admission | 512 source publications: 132,352 to 2,048 source ID reads | [Test](../../tests/audio-editor-runtime50-scape-publication-index.test.ts) |
| R02 | DAWproject track channel widths | 160 tracks: 51,840 to 960 source/clip identity reads | [Test](../../tests/audio-editor-runtime50-dawproject-width.test.ts) |
| R03 | Audacity snapshot source normalization | 80 sources: 6,400 repeated variant filter visits to zero; one partition per snapshot | [Test](../../tests/audio-editor-runtime50-aup4-source-index.test.ts) |
| R04 | Media disposal protection scan | 10,000 records: 10,000 to one iterator visit for a first matching protector | [Test](../../tests/audio-editor-runtime50-media-disposal-scan.test.ts) |
| R05 | Audacity cropped resample material | One extra joined-output crop copy to zero; allocate the final requested length directly | [Test](../../tests/audio-editor-runtime50-aup4-resample-crop.test.ts) |

Command indexes and export partitions belong to one operation or snapshot
session; the Audacity source normalizer retains no PCM. The DAWproject width
reader reuses maps the export already owns. Stereo vocoders drop 7,680 bytes of
unused oscillator state. Weak analyser owners retain 16 KiB of meter-merge
scratch or 8 KiB of EQ scratch per active input/output bank (16 KiB for both EQ
banks). Live click/noise PCM rings are bounded by channel and processing-window
geometry rather than recording duration.

Split-tool caches share a 65,536-entry/point and 64-record limit, keep only the
latest boundary tuple per clip-array owner, and hold owners weakly. Oversize and
mutable inputs retain linear fallback algorithms. Explicit-GC regressions check
retired clip metadata, tuple owners and replaced boundary arrays. Row readers
retain one current visual result and still poll mutable visual providers. DSP
regressions compare baseline Float32 output digests, block partitions, resets,
link changes, aliases and signed-zero behavior.

## Another 100 runtime work reductions

This batch contains 100 independently probed operations in active audio,
editing, presentation, storage and export paths. The fixtures below include
preparation work where applicable. Counts describe the named operations;
they do not establish an end-to-end speedup. Loading work is excluded. The
attempted FFT loop interchange and locale collators created for every sort
were reverted after timing regressions and are excluded from this inventory. The
IDs deliberately skip A11, U15 and U16; U38 and U39 are recording replacements.

| ID | Operation | Observed work and fixture | Regression |
| --- | --- | --- | --- |
| A01 | Standard filter block buffer resolution | 259 to 3 input channel-buffer reads; 257-frame mono filter block. | [Test](../../tests/audio-editor-runtime100-audio-kernels.test.ts) |
| A02 | Stereo impulse decay envelope | 226 to 113 decay exponentiations; 113-frame stereo impulse. | [Test](../../tests/audio-editor-runtime100-audio-kernels.test.ts) |
| A03 | Effect rack entry-pair avoidance | 400 to 0 native Array.entries pair allocations; complete 400-track rack enumeration. | [Test](../../tests/audio-editor-runtime100-audio-racks.test.ts) |
| A04 | Direct master effect lookup | 800 to 0 unrelated track effect getter reads; 400 tracks, master effect lookup. | [Test](../../tests/audio-editor-runtime100-audio-racks.test.ts) |
| A05 | Nearest beat binary search | 1,000,000 to 2,000 absolute distance calculations upper bound; 1000 beats and 1000 downbeats. | [Test](../../tests/audio-editor-runtime100-audio-assistance.test.ts) |
| A06 | Scene median scratch ownership | 201 to 101 array iterator constructions; 100 score neighborhoods. | [Test](../../tests/audio-editor-runtime100-audio-assistance.test.ts) |
| A07 | Beat pooling short circuit | 127,976 to 16,000 maximum calculations; 8000 positive sawtooth logits in two planes. | [Test](../../tests/audio-editor-runtime100-audio-assistance.test.ts) |
| A08 | Streaming TIGER private bank lookup flattening | 195 to 57 private bank header reads including emitted-header preparation; three stems, one channel, 16 emitted frames after one public streaming chunk. | [Test](../../tests/audio-editor-runtime100-audio-streaming-overlap.test.ts) |
| A09 | STFT scratch reuse | 19 to 3 Float64 scratch allocations; 4096-frame source, nine time frames. | [Test](../../tests/audio-editor-runtime100-audio-fourier.test.ts) |
| A10 | Inverse STFT scratch reuse | 21 to 5 Float64 scratch allocations; 4096-frame source, nine time frames. | [Test](../../tests/audio-editor-runtime100-audio-fourier.test.ts) |
| A12 | Vocoder coefficient geometry sharing | 140 to 40 sine coefficient designs; stereo processor update from 40 to 20 bands. | [Test](../../tests/audio-editor-runtime100-audio-kernels.test.ts) |
| A13 | Beat FFT shared butterfly trigonometry | 20,480 to 4,092 cosine calls; 1500 source samples, four FFT frames. | [Test](../../tests/audio-editor-runtime100-audio-mel.test.ts) |
| A14 | Beat magnitude shared normalization | 2,052 to 1 square roots; 1500 source samples, four FFT frames. | [Test](../../tests/audio-editor-runtime100-audio-mel.test.ts) |
| A15 | Sparse Slaney mel projection | 654,852 to 137,572 Float32 round operations; 1500 source samples, four FFT frames. | [Test](../../tests/audio-editor-runtime100-audio-mel.test.ts) |
| A16 | Exact required WavPack sample-word verification | 4,096 to 1,024 exact word/byte comparator callback visits; 1024 Float32 words including signed zero and multiple NaN payloads. | [Test](../../tests/audio-editor-runtime100-audio-pcm.test.ts) |
| A17 | Adaptive AUP4 scalar probes | 120 to 8 Array.filter result allocations; 4096-frame clip with a 2,000-frame sine fade. | [Test](../../tests/audio-editor-runtime100-audio-envelopes.test.ts) |
| A18 | AUP4 envelope maximum scan | 1,001 to 2 largest Math.max argument list; 1000 authored envelope points. | [Test](../../tests/audio-editor-runtime100-audio-envelopes.test.ts) |
| A19 | Convolution unfilled suffix clear | 2,752 to 1,752 cleared Float64 scratch samples; 17-tap kernel over1000 PCM frames. | [Test](../../tests/audio-editor-runtime100-audio-convolution.test.ts) |
| A20 | Immutable track envelope preparation | 50 to 1 track envelope point sorts; 50 clips sharing 40 frozen numeric track envelope points. | [Test](../../tests/audio-editor-runtime100-audio-envelopes.test.ts) |
| E01 | Normalize take lane ordering | 80,200 to 0 Array.find predicate visits; 400 take lanes in reversed authored order. | [Test](../../tests/audio-editor-runtime100-editing-graph.test.ts) |
| E02 | Validate legacy folder bus ownership | 20,100 to 0 native includes indexed element reads; 200 independently bus-owning folders. | [Test](../../tests/audio-editor-runtime100-editing-graph.test.ts) |
| E03 | Reconcile V21 folder assignment endpoints | 20,100 to 0 native includes indexed element reads; 200 folders and 400 graph assignment edges. | [Test](../../tests/audio-editor-runtime100-editing-graph.test.ts) |
| E04 | Validate V21 folder assignment tuples | 20,300 to 0 Array.some predicate visits; 200 folder-owned audio tracks. | [Test](../../tests/audio-editor-runtime100-editing-graph.test.ts) |
| E05 | Project compact mixer send routes | 40,803 to 203 Array.filter predicate visits; 200 sends and 203 graph edges. | [Test](../../tests/audio-editor-runtime100-editing-graph.test.ts) |
| E06 | Resolve programme graph audibility | 43,803 to 249 Set allocations including reader preparation; 120 solo tracks; all queried 3 times. | [Test](../../tests/audio-editor-runtime100-editing-graph.test.ts) |
| E07 | Prepare range deletion | 20,102 to 38 Array.find predicate visits; 200 immutable clips on one track. | [Test](../../tests/audio-editor-runtime100-editing-preparation.test.ts) |
| E08 | Prepare punch replacement | 40,201 to 37 Array.find predicate visits; 200 immutable clips on one track. | [Test](../../tests/audio-editor-runtime100-editing-preparation.test.ts) |
| E09 | Prepare processed range replacement | 20,101 to 37 Array.find predicate visits; 200 immutable clips on one track. | [Test](../../tests/audio-editor-runtime100-editing-preparation.test.ts) |
| E10 | Prepare single-clip overwrite | 20,102 to 238 Array.find predicate visits; overwrite last of 200 immutable clips onto first clip. | [Test](../../tests/audio-editor-runtime100-editing-preparation.test.ts) |
| E11 | Prepare three-point overwrite | 20,104 to 40 Array.find predicate visits; 200 immutable clips on target lane. | [Test](../../tests/audio-editor-runtime100-editing-preparation.test.ts) |
| E12 | Project whole-track gesture selection | 20,100 to 0 native includes indexed element reads; 200 selected clips on 200 tracks. | [Test](../../tests/audio-editor-runtime100-editing-controller.test.ts) |
| E13 | Prepare media destination lanes | 20,300 to 1,612 Array.some predicate visits including canonical admission; 200 selected clips on 200 tracks. | [Test](../../tests/audio-editor-runtime100-editing-controller.test.ts) |
| E14 | Prepare grouped loop source bounds | 20,100 to 0 Array.find predicate visits; 200 clips backed by200 immutable sources. | [Test](../../tests/audio-editor-runtime100-editing-controller.test.ts) |
| E15 | Prepare duplicate lane completeness | 40,800 to 800 Array.filter predicate visits; 200 selected tracks in 100 lane groups. | [Test](../../tests/audio-editor-runtime100-editing-controller.test.ts) |
| E16 | Prepare annotation destination ownership | 40,200 to 0 Array.find predicate visits; 200 copied tracks in200 immutable destination sequences. | [Test](../../tests/audio-editor-runtime100-editing-annotations.test.ts) |
| E17 | Admit annotation sequence maps | 40,200 to 0 Array.find predicate visits; 200 copied tracks in200 immutable destination sequences. | [Test](../../tests/audio-editor-runtime100-editing-annotations.test.ts) |
| E18 | Resolve move gesture participants and owners | 21,784 to 7,264 Array.find predicate visits across public service (unmodified seed expansion remains); 120 selected clips on 120 tracks. | [Test](../../tests/audio-editor-runtime100-editing-move.test.ts) |
| E19 | Resolve fresh-track move source span | 14,523 to 7,263 Array.find predicate visits across public service (unmodified seed expansion remains); 120 selected clips on 120 tracks. | [Test](../../tests/audio-editor-runtime100-editing-move.test.ts) |
| E20 | Prepare pointer duplicate owner mapping | 7,261 to 1 Array.find predicate visits; 120 transformed clips on120 original tracks. | [Test](../../tests/audio-editor-runtime100-editing-move.test.ts) |
| E21 | Admit unique AXML references per XML owner | 79,800 to 0 Array.some predicate visits; 400 content references in one programme; raw XML/order preserved. | [Test](../../tests/audio-editor-runtime100-editing-adm.test.ts) |
| E22 | Resolve ADM nonterminal-strip diagnostics | 20,100 to 5 Array.some predicate visits including canonical admission; 200 authored assignments to nonterminal immutable tracks. | [Test](../../tests/audio-editor-runtime100-editing-adm.test.ts) |
| E23 | Admit combined ADM Mix and Render downstream ownership | 60,300 to 201 Set.has probes for node IDs; 200 groups in a reverse-authored programme chain. | [Test](../../tests/audio-editor-runtime100-editing-adm.test.ts) |
| E24 | Build combined Mix and Render programme snapshot closure | 102,697 to 1,799 Set.has probes for node IDs including snapshot preparation; 200 groups in a reverse-authored programme chain. | [Test](../../tests/audio-editor-runtime100-editing-adm.test.ts) |
| E25 | Prepare locked-track relationship snapshots | 100,100 to 20,100 Array.filter predicate visits across snapshot preparation (hierarchy filters remain); 100 locked tracks and 100 clips paired by group and A/V link. | [Test](../../tests/audio-editor-runtime100-editing-lock.test.ts) |
| E26 | Resolve grouped trim edge participants | 40,201 to 3 Array.find predicate visits across public grouped trim participant preparation; 200 grouped immutable clips on 200 tracks; current active track retains its independent neighboring edges. | [Test](../../tests/audio-editor-runtime100-editing-trim.test.ts) |
| U01 | Take dialog group track resolution | 820 to 0 Array.find predicate visits; 40 groups on 40 tracks. | [Test](../../tests/audio-editor-runtime100-ui-projection.test.ts) |
| U02 | Take dialog lane grouping | 16,000 to 0 Array.filter predicate visits; 40 groups with 20 lanes and 20 takes. | [Test](../../tests/audio-editor-runtime100-ui-projection.test.ts) |
| U03 | Cycle recording sequence membership | 6,400 to 80 sequence.trackIds reads; 80 armed tracks and 80 sequences with duplicate track references. | [Test](../../tests/audio-editor-runtime100-ui-models.test.ts) |
| U04 | Translation filter draft lookup | 20,300 to 200 draft entry key reads; 200 messages and 200 draft entries. | [Test](../../tests/audio-editor-runtime100-ui-models.test.ts) |
| U05 | Routing folder candidate reconciliation | 32,240 to 0 identity Array.find predicate visits; 80 folder-owned groups and 160 assignments. | [Test](../../tests/audio-editor-runtime100-ui-routing.test.ts) |
| U06 | Routing shared ancestor discovery | 10,100 to 400 folder Map.get calls; 100 tracks sharing a 100-folder chain. | [Test](../../tests/audio-editor-runtime100-ui-routing.test.ts) |
| U07 | Routing predecessor median sorting | 118 to 62 numeric predecessor sorts; 60 tracks, 60 groups, master and output. | [Test](../../tests/audio-editor-runtime100-ui-routing.test.ts) |
| U08 | Routing VCA placement lookup | 9,150 to 0 pending-node Array.find visits; 60 VCAs among 182 nodes. | [Test](../../tests/audio-editor-runtime100-ui-routing.test.ts) |
| U09 | Routing ordered rank column reuse | 2 to 1 rank-column sorts; 60 tracks, 60 groups, 60 VCAs. | [Test](../../tests/audio-editor-runtime100-ui-routing.test.ts) |
| U10 | Export matrix retained gain partition | 2,048 to 0 retained contribution Array.filter visits; 32 inputs, 64 retained contributions, 1 output. | [Test](../../tests/audio-editor-runtime100-ui-models.test.ts) |
| U11 | Export matrix single-cell path copy | 31 to 0 unmodified frozen rows copied; 32 by 32 frozen matrix. | [Test](../../tests/audio-editor-runtime100-ui-models.test.ts) |
| U12 | Timeline media membership admission | 500 to 1 clip identity reads; 500 audio clips; first is referenced by one audio track. | [Test](../../tests/audio-editor-runtime100-ui-models.test.ts) |
| U13 | Disabled clip-navigation admission | 1 to 0 unnecessary clip kind reads; blocked menu with selected track and audio clip. | [Test](../../tests/audio-editor-runtime100-ui-models.test.ts) |
| U14 | Effect target selection membership | 90,300 to 300 selected track ID element reads; 300 selected IDs, 301 candidate tracks. | [Test](../../tests/audio-editor-runtime100-ui-models.test.ts) |
| U17 | Custom toolbar action resolution | 20,000 to 200 action identity reads; 100 custom buttons and 200 current actions. | [Test](../../tests/audio-editor-runtime100-ui-presentation.test.tsx) |
| U18 | Keyboard map binding presentation | 45,050 to 200 binding key reads; 100 key/state/context queries on 200 bindings. | [Test](../../tests/audio-editor-runtime100-ui-presentation.test.tsx) |
| U19 | Keyboard map modifier row reuse | 1 to 0 keyboard layout flatten passes per modifier change; mounted keyboard dialog Ctrl modifier click. | [Test](../../tests/audio-editor-runtime100-ui-presentation.test.tsx) |
| U20 | Custom action search text preparation | 6,000 to 200 action path reads; 30 search edits over 200 frozen actions. | [Test](../../tests/audio-editor-runtime100-ui-presentation.test.tsx) |
| U21 | Custom symbol search normalization | 6,000 to 200 symbol replaceAll normalization calls; 30 queries over 200 frozen symbol names. | [Test](../../tests/audio-editor-runtime100-ui-presentation.test.tsx) |
| U22 | Translation option source lookup | 20,100 to 200 draft entry key reads; 200 option source lookups. | [Test](../../tests/audio-editor-runtime100-ui-presentation.test.tsx) |
| U23 | Source ruler precision preparation | 101 to 2 Math.log10 calls; 100 visible source-ruler ticks. | [Test](../../tests/audio-editor-runtime100-ui-models.test.ts) |
| U24 | Stereo meter presentation scratch | 1 to 0 channel snapshot slice allocations; one stereo channel presentation. | [Test](../../tests/audio-editor-runtime100-ui-models.test.ts) |
| U25 | Dynamics parameter membership | 45,369 to 0 linear parameter membership work; 13 assigned and 200 extension parameters. | [Test](../../tests/audio-editor-runtime100-ui-presentation.test.tsx) |
| U26 | ADM bed assignment projection | 20,100 to 200 assignment strip identity reads; 200 bed rows and 200 assignments. | [Test](../../tests/audio-editor-runtime100-ui-presentation.test.tsx) |
| U27 | Label viewport preparation fusion | 1,500 to 500 label identity reads during preparation; 500 label intervals. | [Test](../../tests/audio-editor-runtime100-ui-projection.test.ts) |
| U28 | Annotation viewport visibility publication | 500 to 0 intermediate visibility Array.filter visits; 500 visible annotations. | [Test](../../tests/audio-editor-runtime100-ui-projection.test.ts) |
| U29 | Automation adaptive probe allocation | 311 to 0 mapped probe array allocations; 4096-frame sine curve; baseline frame SHA-256 f953160e3d98bf51b657dcfe1fb4d183006e04a7899d2826a903792e33bec56c. | [Test](../../tests/audio-editor-runtime100-ui-projection.test.ts) |
| U30 | Source-editor discarded flank spreads | 2 to 1 arbitrary clip metadata spread reads; fully selected 100-frame source with no unused flanks. | [Test](../../tests/audio-editor-runtime100-ui-models.test.ts) |
| U31 | Unchanged strip-meter display equality | 400 to 0 Math.log10 calls; 100 equal stereo publications. | [Test](../../tests/audio-editor-runtime100-ui-meter.test.tsx) |
| U32 | Unchanged mixer bar publication | 40 to 0 unchanged bar render logarithms; 20 newly allocated but visually equal stereo meter snapshots. | [Test](../../tests/audio-editor-runtime100-ui-meter.test.tsx) |
| U33 | Production strip publication lookup | 5,050 to 0 native numeric inventory reads; 200 descriptor admissions separately; 100 selectors on one frozen 100-strip publication. | [Test](../../tests/audio-editor-runtime100-ui-meter.test.tsx) |
| U34 | Routing topological rank propagation | 79,600 to 1,195 rank Map.get calls; 200-node reverse-authored DAG; historical cyclic fallback compared. | [Test](../../tests/audio-editor-runtime100-ui-paint.test.ts) |
| U35 | Waveform canvas subtree lookup | 200 to 100 canvas subtree queries; 100 canvases normalized before 100 geometry reads. | [Test](../../tests/audio-editor-runtime100-ui-paint.test.ts) |
| U36 | Spectrogram tile source geometry preparation | 257 to 2 source origin field reads; 256-column unwarped tile; reset geometry for each sequential tile planning batch. | [Test](../../tests/audio-editor-runtime100-ui-spectrogram.test.ts) |
| U37 | Spectrogram integer stride iteration | 256 to 0 boxed pixel-position pushes; 256 columns; existing fractional-width/stride/warp/loop/cancellation compatibility. | [Test](../../tests/audio-editor-runtime100-ui-spectrogram.test.ts) |
| U38 | Recording input conflict checks | 2,114 to 0 temporary arrays for 32 devices with 64 channels and 64 assigned routes (mono); stereo: 1,057 to 0. | [Test](../../tests/audio-editor-runtime100-ui-recording-options.test.tsx) |
| U39 | Recording preview peak windows | 131,072 to 0 temporary Float32 copy bytes; eight channels with 4,096 peak numbers each, over an 8,192-frame visible window. | [Test](../../tests/audio-editor-runtime100-ui-recording-peaks.test.ts) |
| R01 | DAWproject channel and folder routing identities | 25,600 to 0 Array.find predicate visits; 160 audio tracks, 160 groups and 160 sends. | [Test](../../tests/audio-editor-runtime100-export-routing.test.ts) |
| R02 | DAWproject automation strip partition | 83,031 to 2,631 Array.filter predicate visits; 200 tracks and 200 immutable automation lane addresses. | [Test](../../tests/audio-editor-runtime100-export-automation.test.ts) |
| R03 | DAWproject routing-report endpoint lookup | 40,200 to 200 Array.find predicate visits; 200 graph edges and 200 immutable output identities. | [Test](../../tests/audio-editor-runtime100-export-routing-report.test.ts) |
| R04 | Fitting derivative-cache admission | 1 to 0 full-inventory eviction sorts; 1,200 fitting, unexpired cache entries. | [Test](../../tests/audio-editor-runtime100-cache-planning.test.ts) |
| R05 | Scape structural witness clustering without per-probe active arrays | 1,000 to 0 Array.filter calls and replacement active-array allocations during one bind; 1,000 adjacent 4-byte recorded header windows, producing one 4,000-byte retained cluster; preparation is included in the public record/bind path. | [Test](../../tests/audio-editor-runtime100-scape-witness.test.ts) |
| R06 | AUP4 overlap lane partition | 12,720 to 2,016 native numeric Array.findIndex predicate probes in public createAup4ExportPlan; 160 same-start clips in reverse-authored identity order on one audio track. | [Test](../../tests/audio-editor-runtime100-aup4-overlap-lanes.test.ts) |
| R07 | DAWproject requested metadata tag lookup | 7,019 to 0 Array.find tag predicate visits; 1,000 custom tags and mixed-case author credits. | [Test](../../tests/audio-editor-runtime100-export-metadata.test.ts) |
| R08 | DAWproject foreign folder bus reachability | 2,420 to 1,618 Array.filter predicate visits; 200 immutable foreign folders and 20 delivered audio tracks. | [Test](../../tests/audio-editor-runtime100-export-folder-projection.test.ts) |
| R11 | Memory prune chunk key partition | 16,440 to 801 source chunk iterator visits; 40 deleted generations with 20 chunks each plus 1 protected chunk. | [Test](../../tests/audio-editor-runtime100-retention-memory.test.ts) |
| R12 | Temporary cleanup scalar media roots | 655,360 to 0 encoded payload bytes passed to structuredClone; 10 memory assets with 64 KiB encoded payloads. | [Test](../../tests/audio-editor-runtime100-retention-memory.test.ts) |
| R13 | Memory derivative query selected clones | 500 to 0 full inventory Array.map predicate visits; 500 derivatives, 1 matching source/type. | [Test](../../tests/audio-editor-runtime100-retention-memory.test.ts) |
| R14 | Memory derivative deletion selected disposal records | 500 to 0 full inventory Array.map predicate visits; 500 derivatives, 1 matching deletion. | [Test](../../tests/audio-editor-runtime100-retention-memory.test.ts) |
| R15 | Source metadata inventory single output array | 500 to 0 native full inventory Array.map clone visits; 500 references of intermediate output avoided; 500 source records; full clones and inventory membership under cloning getters. | [Test](../../tests/audio-editor-runtime100-retention-memory.test.ts) |
| R16 | Single-pass XML escaping | 6 to 1 full-string escape scans; 500-character attribute text with entities, Unicode and controls. | [Test](../../tests/audio-editor-runtime100-export-xml.test.ts) |
| R17 | Bounded per-document indentation reuse | 1,001 to 1 String.repeat calls; 1,000-child XML document with shallow repeated depth. | [Test](../../tests/audio-editor-runtime100-export-xml.test.ts) |
| R18 | Memory original media deletion selection | 500 to 0 full inventory Array.map predicate visits; 500 inventory rows with selected outputs; snapshot membership, getter mutation, clone ownership and error order parity. | [Test](../../tests/audio-editor-runtime100-storage-selection.test.ts) |
| R19 | Memory source generation detachment selection | 500 to 0 full inventory Array.map predicate visits; 500 inventory rows with selected outputs; snapshot membership, getter mutation, clone ownership and error order parity. | [Test](../../tests/audio-editor-runtime100-storage-selection.test.ts) |
| R20 | Memory source chunk stream selection | 500 to 0 full inventory Array.map predicate visits; 500 inventory rows with selected outputs; snapshot membership, getter mutation, clone ownership and error order parity. | [Test](../../tests/audio-editor-runtime100-storage-selection.test.ts) |

Indexes for editing, export and memory pruning belong to one invocation, view,
or immutable owner. Identity admission preserves first or last duplicate
authority as the original operation requires. Mutable records, accessors,
sparse arrays and custom traversal retain the original live-read paths.
Small command selections retain short-circuit traversal before index admission.
Export maps retain identities and lane references, never copied PCM. The
metadata lookup retains at most eight requested keys. Recording preview windows
box native peak views directly into detached number arrays, without a temporary
Float32 copy; custom iterators, species, accessors and shared buffers keep the
original slicing path. XML indentation reuse retains at most 65 strings and 4,160 characters for one serialization; deeper
nesting uses the original calculation.

Custom action and symbol search retain at most 16,384 entries and 4,194,304
derived characters for the current view. Keyboard presentation is bounded to
16,384 bindings. Strip publication lookup admits at most 128 strips and keeps
one weak owner. Explicit-GC regressions check that retired UI inventories and
meter publications remain collectible. Matrix edits share only frozen rows;
mutable matrices still produce independent copies. Meter equality preserves
fresh publications and scalar polling while avoiding unchanged display work.

STFT and inverse STFT reuse two 2,048-element Float64 scratch planes (32 KiB)
per invocation/channel instead of allocating them for every frame. Their
existing 16 KiB window is unchanged. The impulse generator keeps per-channel
seeds and references, with no impulse-sized envelope buffer. Streaming TIGER overlap keeps the same ring buffers and processing order,
removes nested private ring headers, and uses at most 192 temporary output
references during emission. It adds no PCM storage. Convolution reuses its existing storage and clears only the
unfilled suffix. No additional persistent audio cache is introduced.

The AUP4 overlap index activates only for sustained wide overlap. Its active
and free numeric heap entries together are bounded by the allocated lane
count minus the first eight linearly queried lanes. Sparse and short dense
preludes use the previous kernel; invalid or custom inputs preserve historical
traversal. Independent randomized fixtures and an exact public export-plan
digest check lane assignment. Timing the complete admitted lane kernel also
checks sparse and mixed projects; public plan probe counts alone do not
predict complete export latency.

Memory repositories preserve inventory membership snapshots, clone ownership,
mutation/error order and asynchronous chunk-yield behavior. Temporary cleanup
reads scalar protection roots without cloning encoded assets. Pruning builds
only a temporary token-to-string-key partition. Scape witness clustering
compacts private arrays in place and keeps the existing structural witness
byte ceiling. The fitting-cache shortcut runs after complete account validation
and safe byte summation; expiry and pressure still use the original ordering.

For memory-constrained validation, run one job at a time. The combined new
regression suite uses one Node test worker and a 1 GiB heap cap; compiler and
lint jobs need separate, larger caps. Stream and compact complete V8 profiles
when collecting full-suite coverage rather than retaining all raw profiles.
Keep the same test selection, source-map precedence, merged ranges and final
coverage report. Browser interaction checks use one Chromium worker; CPU
affinity must still expose enough cores for application worker-policy tests.

These changes do not alter generated assistance runtime sources, dependencies,
recipes, archives or target inventories. No manual **Update AI assets** run is
required.

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
