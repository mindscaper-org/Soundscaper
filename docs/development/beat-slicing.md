# Soundscaper beat slicing and gap smoothing implementation guide

This guide defines the proposed edit contracts and implementation sequence for
beat slicing and gap smoothing in Soundscaper. The
[post-1.0 roadmap](../../roadmap.md#9-soundscaper-beat-slicing-and-gap-smoothing)
owns scope, status, and release sequencing. These are planned capabilities;
this guide does not enable a command or allocate a project schema version.

## Scope and user workflow

Deliver an opt-in workflow for tightening recorded percussion: detect attacks,
split around them, move the slices toward a grid or groove, and repair the
resulting gaps and overlaps. The audio within each slice keeps its original
speed and pitch. Coordinated editing of several microphone tracks is part of
the first complete release of this feature.

Propose **Effect > Pitch and tempo > Beat slicing and gap smoothing**, beside
the existing Audio warp and transients entry. This is a proposed command, not
an existing menu item. Its dialog owns track/reference selection, detection
sensitivity and spacing, attack lead-in, grid/groove and correction strength,
crossfade length/shape, analysis, audition, and Apply/Cancel. Reuse existing
control and time-entry components. Add no persistent toolbar button, panel,
rail, badge, or inline timeline control. Localize copy through the
[localization workflow](localization.md), support keyboard completion, announce
refusal reasons, and restore focus to the invoking menu.

The initial admitted material is forward-playing, sample-anchored audio with
unity speed, no pitch offset, no warp map or looping, and source PCM at the
project sample rate. Require one continuous clip per participating track over
a common selected time range, with no pre-existing overlaps in that range.
Different clip start positions and source in-points are allowed when their
mapping into the common range is exact. Mono, stereo, and admitted multichannel
clips retain all channels as one editing unit.

Refuse locked/frozen or read-only targets, missing media, incompatible clip
groups, active comp regions, and A/V-linked material rather than breaking their
contracts. Explain when an existing render/bounce workflow can produce suitable
audio; never flatten or unlink it implicitly. Keep the selected range's outer
boundaries fixed and leave media outside it unchanged.

Non-goals are continuous warping, sample-to-MIDI/Drum Rack conversion, drum
replacement, tempo-map extraction, generated room tone, spectral repair,
per-track phase correction, persistent linked-track groups, and automatic
handling of arbitrary comped or layered arrangements. Existing warp/groove
editing remains independently available. MIDI and the other post-1.0 extensions
are not prerequisites; shared code does not enable this feature in Framescaper.

## Existing architecture and ownership

Follow [architecture and maintainability](../architecture/overview.md),
[time and media](../architecture/time-and-media.md),
[production and rendering](../architecture/production-rendering.md), and
[project compatibility](../policies/project-compatibility.md).

| Existing owner | Reuse and remaining work |
| --- | --- |
| [`transient-analysis.ts`](../../src/common/editor/transient-analysis.ts), its worker, and [`transient-analysis-service.ts`](../../src/common/editor/controller/analysis/transient-analysis-service.ts) | Reuse bounded PCM analysis, source-frame positions, detector parameters, digest-bound caches, cancellation, and source authority checks. They do not plan cuts or repairs. |
| [`audio-groove-template.ts`](../../src/common/editor/audio-groove-template.ts) and [`audio-warp-domain.ts`](../../src/common/editor/audio-warp-domain.ts) | Reuse exact grid/groove arithmetic and strength validation through narrow imports. Existing quantisation changes warp anchors; add a planner for rigid slice movement instead of routing through warp commands. |
| [`audio-warp-composition.ts`](../../src/common/editor/controller/track-audio/internal/audio-warp/audio-warp-composition.ts) | Reference for selected-clip analysis and lifecycle integration. Its single-clip workflow is not a multitrack editing service; do not import its internal implementation from another controller domain. |
| [`protocol.ts`](../../src/common/editor/commands/protocol.ts) and [`frame-canonical-trim-planning.ts`](../../src/common/editor/frame-canonical-trim-planning.ts) | Reuse command/history, split/trim preservation, and exact edit authorities. Validate their suitability for one atomic multitrack operation before choosing a batch or a focused command. |
| [`audio-clip-overlap.ts`](../../src/common/editor/audio-clip-overlap.ts), [`audio-clip-transition-gain.ts`](../../src/common/editor/audio-clip-transition-gain.ts), and [`clip-fade-presets.ts`](../../src/common/editor/clip-fade-presets.ts) | Existing proper overlaps generate automatic crossfades with shared gain evaluation and shape presets. They do not extend source handles, close gaps, or protect attacks. |
| [`runtime-clip-projection.ts`](../../src/common/editor/runtime-clip-projection.ts) and [`lifecycle.ts`](../../src/common/editor/controller/shared/lifecycle.ts) | Resolve persisted time authorities and bind async work to the current project/task generation. A generation token alone does not prove that participants or tempo remained unchanged. |

Put deterministic selection admission, slice placement, and boundary repair in
small strict-TypeScript domain modules under `src/common/editor/`. Proposed
names such as `beat-slice-plan.ts` and `beat-slice-boundary-plan.ts` describe
future modules. Keep stateful orchestration under
`controller/track-audio/internal/`, analysis under its existing public owner,
document mutation under the command owner, and presentation under `ui/`.
Register new source/test ownership in `config/module-policy.json`; expose only
the required controller contract through `config/controller-domain-policy.json`.
Use direct imports, handle every promise, and preserve dependency, file-size,
coverage, startup, and chunk budgets. Extract helpers from ratcheted files when
necessary instead of growing them or raising their limits.

## Analysis and shared edit authority

Capture the project generation and revision, selected range, participant IDs,
track ownership and locks, source identities/content digests, clip timing and
processing state, and tempo/grid/groove settings before analysis. Recheck them
after asynchronous reads and immediately before Apply. A changed participant,
source relink, selection, lock, tempo map, project, or newer request invalidates
the plan; do not apply stale results or quietly rebase them.

Start with an explicitly chosen reference clip. Map its detected source-frame
positions into the common project range and let the user exclude false hits or
add a missing hit in the dialog. Channel-linked detection within one source
does not establish agreement across microphone tracks. A later combined-track
detection mode needs its own merge/deduplication policy and tests; it is not a
prerequisite for reference-driven multitrack editing.

Use one ordered list of accepted attack positions and cuts for every selected
track. Protect participant-specific attacks in prospective source handles as
well: reference-only detection must not license the reintroduction of a kick
or snare found only in another microphone. Analyze needed handle windows with
the same bounded service and conservatively combine their forbidden ranges.
Weak or ambiguous material requires review; detection cannot guarantee that
every audible attack has been found.

The current analysis service accepts a clip ID and analyzes its source range;
UI time selection does not narrow that read. Add an explicitly authorized,
bounded range request in the analysis owner before using selection or handle
windows, preserving source-digest, parameter, and range identity in the cache.
Reuse the existing PCM-access port rather than reading around service admission.

Bound selected duration, channels, detector windows, candidate count, track
count, output clip count, command size, and preview cost before reading PCM or
allocating a plan. Reuse the existing transient admission limits; process
sources/windows with bounded concurrency and release PCM between them. The
current service must not be bypassed with an unbounded full-session read.
Implement a tested window/halo/merge strategy before offering durations beyond
its current admitted range. Keep development within 12 GB RAM and preserve the
existing production resource budgets.

## Slice placement and exact timing

Treat ranges as half-open intervals in integer project sample frames. For each
accepted attack `a[i]`, choose a shared cut `c[i]` before the attack using the
configured lead-in. Clamp only within the allowed preceding decay region;
reject zero-length slices and lead-ins that cross protected attacks. Selection
edges are fixed boundaries, not additional detected beats.

Include the earliest and latest corresponding microphone arrivals in each
shared attack guard. A cut must precede the earliest arrival and the transition
must finish before it; a room microphone's later arrival must remain in the
same slice. Refuse an ambiguous or overlapping guard rather than splitting one
hit across slices or independently shifting its microphone recordings.

Compute each target from absolute position, not repeated rounded intervals:

1. Resolve `a[i]` into the configured grid's coordinate domain using the owning
   time/tempo primitives. Musical grids use exact rational beats, including
   tempo changes; sample grids use exact sample coordinates.
2. Select the grid index and groove offset with the existing grid/groove
   arithmetic. Apply correction strength in that authored domain and project
   the resulting absolute target to samples once with the named point rule.
3. Set `delta[i] = targetFrame[i] - a[i]`. Apply this same integer delta to
   every participant's corresponding slice, including its attack and lead-in.
   Do not quantise each microphone independently or introduce a warp map.
4. Preserve order, positive durations, selection boundaries, and attack guards.
   A collision, out-of-range target, or impossible repair blocks Apply and
   identifies the affected hit; the user can change strength or accepted hits.

For admitted unity-rate audio, derive each source coordinate from its existing
clip projection/trim authority and the absolute project boundary. Never treat
source indices from different recordings as interchangeable. Keep each track's
recorded timing offset intact; this operation must not align microphone phase
or change interchannel delays.

Allocate stable output IDs once per prepared plan. Preserve source references,
gain/polarity, channel selection, routing, annotations, and supported metadata
through the owning split/trim contracts. Slice clip-local envelopes with the
audio and move them with it; timeline track automation retains its timeline
positions. Keep original outer fades at the selection's original outer edges;
only generated internal boundaries receive new smoothing. If a required field
cannot be preserved, refuse before publishing a partial edit.

## Gap and overlap repair

Plan all boundaries after movement and before committing any cuts. For an
outgoing slice ending at `e` and incoming slice beginning at `s`, the signed gap
is `s - e`. The final plan must explain every positive gap and negative overlap.

- **Gap:** prefer extending the incoming source head backwards to meet the
  outgoing slice, then extend far enough for the requested crossfade. Resolve
  the source in-point and duration together so the incoming attack remains at
  its target. Use outgoing tail audio only where its available safe handle
  proves that no following attack is pulled into the transition.
- **Overlap:** trim excess outgoing decay, or another explicitly planned safe
  handle, so the remaining proper overlap has the chosen crossfade duration
  before the incoming protected attack. Never move that attack to fix a join.
- **Touching edges:** create a short overlap only when safe source handles and
  attack guards permit it. Do not claim smoothing from a zero-length fade.
- **Insufficient audio:** report the boundary and limiting track and block
  Apply. Do not synthesize silence, repeat a hit, stretch a tail, or borrow
  material outside the selected range implicitly. A reduced requested fade
  requires a new visible plan, not an undisclosed per-track fallback.

Available handles mean verified retained PCM within both the selected source
range and the safe decay region. A source's total frame count alone does not
prove that an extension is valid. Check source bounds, previous/following
attacks, original trims, and adjacent material outside the selection. Every
track must support the same boundary placement and crossfade interval; the
most restrictive participant limits the whole operation.

For example, at 48 kHz a moved incoming slice starts at frame 48,960 while the
outgoing slice ends at 48,000. Closing the 960-frame gap with a 240-frame fade
requires an incoming head extension of 1,200 frames, to start at 47,760. Its
source in-point moves back by the same amount and its duration grows equally;
the attack's timeline position stays fixed. The 47,760–48,000 overlap must lie
before the attack guard and pass the handle checks on every microphone. A
participant with only 1,100 safe frames makes that proposed repair unavailable.

Reuse proper-overlap geometry and transition-gain evaluation for playback,
audition, export, and waveforms. Preserve supported constant-power and
constant-volume choices; qualify constant-volume as the initial proposal for
correlated adjacent material and expose the choice in the dialog. Persist the
existing paired shape fields consistently. Do not stack manual fades on an
edge already owned by an automatic crossfade, or assume a contained clip or
triple overlap receives the same automatic treatment. Refuse those geometries
in the initial scope.

## Preview, atomic application, and persistence

Keep analysis, accepted hits, settings, the generated edit plan, and audition
state outside the persisted document until Apply. Show counts, shared cut/move
positions, repaired boundaries, and blockers inside the invoked dialog. Offer
bounded original/processed audition through existing render/playback adapters
against a detached plan, without exporting or mutating the active project.
Preview and Apply must consume the same plan and gain rules.

Apply revalidates authority and publishes all selected tracks in one history
transaction. Use the existing batch mechanism if it can validate the complete
operation atomically; otherwise introduce one focused typed command with
bounded payload and expected participant authority. Reuse split/trim reducers
against a private document when appropriate; do not issue separate visible
commits per cut or track. Validation failure leaves the original document
unchanged. Undo restores every original clip, membership, fade, and selection;
redo uses the prepared IDs and values without rerunning detection.

Cancel, superseded analysis, dialog close, project change, or disposal stops
owned work and releases audition resources. Read-only or lock changes revoke
Apply. Repeated previews must not leak sources, graph nodes, buffers, temporary
assets, or autosave/history entries. Source analysis caches remain disposable
derivatives under their existing ownership rules.

Prefer persisting ordinary edited clips, source references, and existing fade
fields; do not persist analysis caches or a second set of derived sample
coordinates. Prove this representation through Scape save/reopen, autosave,
recovery, playback, and export. If a durable recipe or relation becomes
necessary, stop and review its schema, migration, unknown-feature custody,
clone/serialization, and AUP4 disposition before allocating a version. Never
invent a schema number in this guide. Existing interchange limits must remain
truthful; verify representable audio and report any omissions.

## Implementation packets and gates

Begin behavior changes with focused failing tests against the owning modules.
All packets preserve the timing, source-retention, shared-microphone,
transaction, and resource invariants above and exclude the stated non-goals.
Commit completed packets atomically. The first feature release requires BS01
through BS06; a development-only single-track planner is not full support.

| Packet | Prerequisites | Outcome and acceptance | Stop condition / excluded expansion |
| --- | --- | --- | --- |
| BS01: admission and fixtures | Existing clip/time/analysis contracts | Close the admitted selection, lead-in/attack guards, handle policy, numeric limits, and independent expected timing/gain fixtures. Test source offsets, unsupported material, limits, and preservation fields in strict TypeScript. | Stop on an unresolved source/time authority or metadata-loss case; do not widen to arbitrary arrangements. |
| BS02: rigid slice planner | BS01 | Produce deterministic cuts, IDs, grid/groove targets, and shared deltas without mutation. Cover zero/partial/full strength, tempo changes, selection edges, collisions, and exact source mappings. | Stop when movement cannot preserve order or scope; do not use warp processing as a substitute. |
| BS03: boundary repair | BS02 | Produce source-bounded extensions/trims and proper paired fades; verify the numerical example above, attack protection, no duplicate hits, and independent PCM/gain expectations. | Block unresolved joins and unsupported overlap geometry; no silent fill, stretch, or fade reduction. |
| BS04: multitrack and transaction | BS03 | Apply common cuts/deltas/fades to all participants with reference-driven analysis, restrictive handle admission, stale-result rejection, one-step undo/redo, and source/metadata preservation. | Stop on any participant failure or an unsafe command boundary; no partial application or persistent edit-group subsystem. |
| BS05: menu, review, and audition | BS04 | Complete the proposed menu/dialog workflow, hit review, settings, bounded A/B audition, cancellation, focus, keyboard/accessibility, and localized refusal paths on web and desktop. | Keep enablement unavailable if preview and committed output differ; add no permanent editor chrome. |
| BS06: persistence and release qualification | BS05 | Pass Scape/recovery and supported interchange, playback/export parity, multitrack/browser regression, and bounded long-selection checks. Update capabilities, handbook/comparisons, and roadmap status only after evidence exists. | Do not claim support from detector/split APIs alone or relax existing quality budgets; broader input forms need separate packets. |

## Verification and completion criteria

Use hand-derived timeline/source vectors and independently generated PCM, not
only a planner followed by its own inverse. Include:

- **Timing:** impulses and decaying hits at 44.1/48/96 kHz, exact halfway grid
  ties, swing/groove depth, tempo changes, nonzero origins, first/last hits,
  zero/half/full strength, dense candidates, collisions, and safe integer limits.
- **Repair:** gaps, touching edges, oversized overlaps, insufficient handles,
  attacks just inside/outside fade guards, waveform discontinuities, correlated
  and uncorrelated decays, both fade shapes, existing outer fades, and no
  duplicate or attenuated protected attack. Verify exact boundary coordinates
  and independent gain values as well as audible output.
- **Multitrack:** kick/snare/overhead/room fixtures with distinct source
  in-points, channel counts, intentional microphone delays, a hit absent from
  the reference, and a single track with insufficient handles. Assert identical
  edit deltas and fade intervals, preserved delays, and all-or-nothing refusal.
- **Lifecycle/history:** cancellation during read/worker/audition, project
  switch, relink, changed selection/tempo/lock, overlapping requests, command
  validation failure, repeated preview cleanup, and one-step undo/redo with
  stable identities and no detection rerun.
- **Persistence/rendering:** source bytes and envelopes after Scape/recovery,
  save/reopen output, audition/live/offline PCM parity within existing fixed
  tolerances, supported AUP4 disposition, unchanged outside-range material,
  track automation, and unrelated tracks.
- **Interactive/resources:** menu-only discovery, reference and hit selection,
  localized blockers, keyboard/focus/screen-reader behavior, the maintained
  Chromium/Firefox/WebKit matrix and desktop path, plus preflight rejection of
  excessive tracks, clips, candidates, duration, or preview allocations.

Follow the [testing guide](testing.md): run focused Node regressions against
the new owning modules, `npm run lint:changed`, and `npm run typecheck`; build
and run the selected browser workflow when interaction changes. Agents never
run the full suites. At implementation handoff, report actual checks and give
the owner the exact absolute-worktree commands for `npm run check` and, for the
interactive implementation, `npm run test:browser`. Preserve all existing
licensing, platform, GPU, and reproducibility contracts; this feature requires
no new model or native runtime.
