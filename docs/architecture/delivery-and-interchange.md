# Delivery and interchange

Delivery turns a validated project plan into user-owned artifacts. Interchange
describes the same project or render for another application. Both use the
editor's canonical timing, visibility, media, and publication rules; neither is
a parallel export engine.

This page records the maintained semantic and publication contracts. Current
source modules and machine-readable registers are authoritative; roadmap status
and diagnostic campaigns do not change delivery behavior.

## Authorities

- `createExportPlan` and the video plan builders define delivery semantics.
- `src/common/editor/video-export-plan-version.ts` is the graph-plan version
  authority. Other plan families have separate closed version surfaces.
- `delivery-preset.ts`, `delivery-queue.ts`, and `delivery-report.ts` own the
  shared preset, queue, and report vocabularies.
- Product strategies and admitted browser or desktop executors run an already
  validated plan; they do not change its meaning.
- `config/production-licensing-matrix.json` and the
  [licensing policy](../policies/licensing.md) decide what may be
  distributed. A preset or runtime probe cannot grant that permission.
- Project identity, opaque custody, and fallback preservation remain governed
  by [`project-compatibility.md`](../policies/project-compatibility.md).

`config/quality-budgets.json` describes automated diagnostics, not release
certification. The repository owner makes the release decision under the
[release policy](../operations/release.md).

## Common delivery contract

One semantic plan serves direct export, queued delivery, browser execution,
native execution, presets, batches, and reports. A backend extends plan
admission and execution; it does not invent backend-only project meaning.

Options are validated before expensive work or destination publication.
Unknown versions, unsupported combinations, unavailable capabilities, and
losses that cannot be represented truthfully are typed refusals.

Audio export defaults to no dither and no appended effect tail. The optional
In/Out **Render as loop** delivery renders the isolated loop and its effect
remainder (up to ten seconds), then sums the remainder modulo the loop length
before channel mapping, resampling, normalization, or encoding. The output
retains exactly the loop's duration. Offline renders fold planar PCM in place;
streamed renders fold a temporary PCM spool with bounded memory. Audio before
In does not supply effect history, and loop wrapping is recorded in the report.

Every conversion, omission, fallback, and conformance result appears in a
delivery report. The shared dispositions are `preserved`, `converted`,
`missing`, and `omitted`. Successful output with an unreported conversion is a
contract failure.

Publication preserves the direct-save boundary: select destination authority
before rendering; write to an isolated temporary sink or sibling; seal and,
where supported, reopen and verify the result; then commit atomically without
replacing an unrelated output. Cancellation, failure, stale authority, or
supersession publishes no partial member.

Executor selection is reported. Browser or hardware capability may choose a
faster route only for the same plan. An unavailable route follows the declared
fallback or reports one exact refusal reason; it never silently changes canvas,
timing, channels, captions, color, or quality.

## Reports, presets, and queues

A report records resolved settings, format, range, channel map, dither,
resampling, loudness and normalization, encoder or fallback choice, conformance,
and every conversion or omission. Reports save through the `report` file-service
purpose and are available from the delivery-report menu.

Reports are sealed values. A stage that learns new facts rebuilds the report
from its inventory instead of appending after counts were fixed. Missing
evidence stays absent or explicitly unverified; it never becomes an invented
zero or pass.

A preset is versioned, validated data over plans. It may declare container,
codec, profile, color, audio layout, captions, metadata, executor, fallback,
and licensing status, but contains no private encode path. Catalog visibility
is distinct from execution and distribution. A native target can remain visible
on the browser executor and resolve to a reported unavailable fallback.

The in-session queue provides ordering, explicit reorder, pause between jobs,
cancel, and retry from failure. Each persistent backend declares either tested
resume from authenticated checkpoints or atomic verified restart. Pausing does
not claim that arbitrary encoder bytes can be suspended and resumed.

Queue records contain bounded plans, fingerprints, grants, destinations,
reservations, state, progress, and attempt metadata—not media bodies. Recovery
revalidates the project revision, plan, sources, destination, runtime, and
checkpoints before continuing.

## Audio delivery

Audio delivery extends the ordinary export plan and renderer. Format writers,
channel limits, dither, mapping, resampling, stem archives, and direct
publication remain shared with ordinary export.

### Mastering sequences

A mastering sequence is an ordered view over timeline-annotation regions.
Entries reference region identity and own order, metadata, preceding gap, and
fades; they do not copy time ranges or audio. All positions resolve through the
runtime annotation projection.

Delivery renders each unique region through the ordinary offline renderer,
inserts real silence for gaps, and applies entry fades to output. Each gap and
extent is scaled before output positions are accumulated so rounding cannot move
a boundary away from its audio. The project is never mutated.

Missing or invalid regions produce a typed validation error rather than a
silently shortened sequence. There is no realtime-stream fallback because a
contiguous project stream does not represent the assembled timeline. Stems and
ADM are refused because the maintained plan defines no sequence semantics for
them.

Where a writer supports cues, entries reuse RIFF marker interchange. A writer
without cue support reports the omission without changing audio bytes.

### Loudness, conformance, and batches

Loudness normalization is a plan step, never an encoder flag. The pipeline
measures rendered material, computes one gain from the integrated target and
true-peak ceiling, applies it after channel mapping in the neutral path, and may
measure the delivered samples again.

If the true-peak ceiling prevents the integrated target, gain stops at the
ceiling and the report records the shortfall; delivery adds no unstated limiter.
Normalization is refused for stems, ADM passthrough, and realtime fallbacks.
The destructive loudness effect remains a separate editing action.

When captured, the delivered measurement is stamped into broadcast metadata
and reported beside the projection. A material disagreement is its own finding.
A delivery that does not capture a second measurement reports projections only.

Conformance reads produced bytes before publication when a maintained reader
exists. It checks duration, rate, sample format, channel count and map,
broadcast metadata, cues, ADM, and stamped loudness. A failed check fails the
delivery after sealing an explanatory report. An unsupported or streamed format
reports `conformance-unverified`; lack of a reader is not a pass.

A batch is a list of ordinary plans plus a manifest. Mixes, selections, loops,
regions, mastering sequences, stems, and preset/range alternates are independent
members. Each owns its output and report; the batch also lists members that did
not run. Completed members may publish, but no individual member publishes
partially. Retry selects failed members from the report.

Authored immersive delivery supports beds through 7.1.4, positioned objects,
and binaural rendering. Bed and object routes flatten into one explicit channel
mapping. The binaural report names the renderer and its limitations instead of
implying a measured HRTF.

Opt-in [EBU EAR speaker rendering](../features/ebu-ear.md) consumes that authored
programme before channel encoding. The plan states the source and output
widths separately, and a transient capture project preserves the source routing.
The export-owned worker uses the pinned libear WebAssembly gain calculators;
the report identifies the implementation and output layout. This path exports
speaker PCM and requires offline admission.

ADM passthrough is separate: neutral path, no dither, exact full-source shape,
and chunk preservation. It reproduces admitted bytes or refuses. Authored
immersive features never weaken its refusal rules.

## Video delivery

`canvas.size` states output extent and `canvas.fit` selects `contain`, `cover`,
or `stretch`. Preview and every executor consume the same decision. Quality is
the semantic tier `draft`, `balanced`, or `high`, which each encoder maps to its
own settings; plans do not carry encoder-specific CRF or bitrate values.

Audio layout is `preserve`, `mono`, or `stereo` and is applied to the rendered
mix before video staging. Every video executor receives the same audio. Custom
matrices remain in the audio workflow where per-channel meaning is visible.

Caption delivery is explicit: sidecar through the maintained text writers,
muxed when container and executor admit a track, or burned as a deterministic
render-plan stage. Cue selection and timing are validated before encoding. An
empty range, adjacent cues, script/font gaps, unsupported styling, or a path
that cannot stage captions is handled or reported deliberately. A keyed path
without caption staging refuses captions.

An admitted WebCodecs tier and its maintained fallback consume identical frame,
container, audio, mapping, and metadata plans. Elementary-stream timestamps are
derived from the exact rational frame rate, never a decimal approximation.
Encoder selection and fallback reason are report items.

Platform presets may describe 4K, HDR, 10-bit, hardware encode, mezzanine,
alpha, or image sequences. A preset cannot add codec bytes or clear source,
patent, notice, or provenance requirements. Required color, precision, HDR, or
alpha facts that an executor cannot preserve are refused before work.

## Interchange profiles

EDL, OTIO, and FCPXML describe the rendered edit. They use the shared
interchange visibility projection, including inherited folder state and solo.
Audio mute does not imply picture invisibility. An unrepresentable clip or
feature becomes a report item, never an unreported `continue`.

Their common timing rules are:

- preserve sequence rates as exact rationals, never decimal literals;
- use sample rate for audio-domain items and sequence rate for pictures;
- carry sequence start and drop/non-drop policy into record timecode;
- derive source duration from record duration so rounded ends agree;
- include VFR timing in an explicit metadata namespace; and
- require exact structure and integer boundaries, using tolerance only for an
  inherently floating-point representation.

CMX3600 EDL exports cuts on one selected video or audible audio sequence track,
reel mapping, and timecode; it does not flatten unsupported tracks heuristically.
The default is the first visible video track, then the first contributing audio
track. Source-file, exact-rate, and sequence-origin comments preserve relinking
and initial gaps when the EDL is reopened here. External lists without rate
metadata use a reported default of 30 fps NDF or 30000/1001 DF.
OTIO exports audio/video tracks with gaps, item ranges, sequence/VFR metadata,
and nested stacks where admitted; it does not invent effects, transitions, or
embedded media. FCPXML exports a spine with connected lanes, stable-identity
resources, rational times, format, and default roles.

EDL, OTIO and FCPXML imports share File > Open, the ordinary Import chooser,
and drop routing. They retain cut placement, source trims and sequence clocks;
OTIO also accepts nested tracks/stacks and FCPXML accepts asset clips and
connected lanes. Unsupported effects, time maps, transitions and event/library
authoring appear in the import report. FCPXML contained items respect their
parent's visible range; connected items retain overhangs while respecting any
containing ancestor, following Apple's [timing attributes](https://developer.apple.com/documentation/professional-video-applications/timing-attributes).
Selected companion media and desktop
session-folder lookup bind referenced sources. Missing media retains an offline
source and its edit for relinking rather than silently dropping clips.

Referenced Standard MIDI Files in audio edit-list slots also use this boundary:
OTIO recognizes `.mid`/`.midi` URLs and MIDI track declarations; selected or
embedded audio-slot media can additionally be identified by its `MThd` header.
Each SMF track becomes an editable MIDI lane, retaining the containing cut's
placement and source trim. SMF tempo maps and SMPTE divisions resolve the note
clock; original tempo/meter events stay in clip metadata, without replacing the
project musical clock. These are referenced MIDI files, not a new inline-note
schema for EDL, OTIO or FCPXML. Files without MIDI references cannot recover
notes from rendered audio. Unreferenced companion MIDI must be imported
separately after opening the edit.

OMF uses a bounded OMF2 Bento container with composition, master and source
mobs, mono/stereo WAV essence, gaps and source offsets. Export Other embeds
24-bit PCM audio, with a 256 MiB decoded-PCM limit; the domain writer can also
describe linked WAV sources. Overlapping clips become separate tracks. Import
reads embedded WAV/AIFF or retains linked references, and reports unsupported
components. The profile does not carry picture or editable MIDI authoring.

AAF uses standard AAF 1.2 objects in a bounded Compound File Binary container.
File > Open, Import and drop routing read audio cuts through composition,
master and source mobs, including linked media, embedded WAV/AIFF and
uncompressed PCM essence. Missing sources retain offline edits for relinking.
Single-input effect groups retain their cuts and report omitted processing;
transitions become reported overlapping cuts. Other unsupported components keep
their duration as a reported gap. Source offsets use the referenced slot's edit
rate, independently of the composition rate.

AAF import also reads the standard
[AS-01 edit-protocol MIDI attachment](https://static.amwa.tv/as-01-aaf-edit-protocol-spec.pdf)
(§9): an Auxiliary data-definition slot references an auxiliary SourceMob with
an `AuxiliaryDescriptor` whose MIME type is `audio/midi`. Static, timeline and
event slots are supported; essence may be embedded or linked through existing
companion/folder grants. One whole SMF file is co-timed with composition origin,
and its individual tracks become editable MIDI. Repeated references are read
once; multiple distinct MIDI attachments are refused. Nonzero source offsets
are reported as omitted rather than guessed. A missing file retains an empty
MIDI track and offline source without inventing clip timing. Unknown auxiliary
MIME types remain omitted. Normal AAF export remains the audio profile below.

AAF import reads standard mono/stereo gain operations, top-level mono pan and
one-/two-parameter mono audio dissolves. Constant and linear control points
retain their semantics; gain operations and crossfades multiply clip envelopes
with bounded product error. Track pan becomes an automation lane. Unsupported
interpolators are reported as linear conversions, and nested pan remains an
omission. Vendor operations retain their identity and parameter records in
bypassed entries when their single input can be retained. This is not a general
third-party plug-in state interchange contract.

File > Export other > Export AAF writes mono/stereo audio cuts, source offsets,
gaps, names and exact sequence timecode, and embeds whole sources as 24-bit WAV.
It shares OMF's source staging and 256 MiB decoded-PCM limit. Overlapping clips
use separate tracks. Picture, editable MIDI, processing and automation losses
appear in the delivery report. The domain writer also supports linked WAV
references. The AAF reader, writer and standard dictionary load on demand;
normal products require no Python runtime. The dictionary seed and independent
reader checks are described in the conformance reference.

AES31 ADL imports standalone `.adl` EDML documents and `.adl.zip` transport
packages through Open, Import and drop. The audio profile supports 44.1/48 kHz,
24/25/30 fps non-drop timecode and 30000/1001 drop-frame timecode. Sample
remainders, source origins, cut placement, source trims, static clip gain and
linear fades are retained. Mono/stereo channel selections are materialized into
derived PCM sources, including selections from larger source files. Missing
media remains an offline edit; ambiguous filenames are never chosen arbitrarily.

File > Export other > Export AES31 ADL writes an `.adl.zip` containing a plain
EDML list and whole 24-bit BWF sources with matching originator references and
zero source origins. Extract the package before opening its ADL in another DAW.
Overlaps use separate destination channels. The profile reports omitted native
track names, nonlinear fades, effects, routing, automation, markers and video;
retimed, reversed and repeated clips require rendering before exchange and are
reported as omitted. ASCII conversion and PCM quantization are reported.
Unsupported clocks are refused, never approximated. XML AES31-4 is outside this
profile, and independent DAW conformance remains explicitly unverified.

Exports stream to prepared destinations, with a 256 MiB limit on download-only
packages. Package imports admit at most 10,000 entries and 512 MiB of expanded
bytes, validate paths and CRCs, and require exactly one ADL. Standalone linked
media uses the existing desktop folder authority or selected browser companions.

DAWproject is project exchange, not a rendered edit list. Muted tracks are
exported as muted rather than omitted. Exact sample positions, beat-positioned
tempo and signature maps, and float32 WAV media preserve the maintained scope.
MIDI clips exchange editable standard Notes. Soundscaper comment metadata
retains auxiliary MIDI messages and instrument/program settings; receiving
applications must assign their own instrument. Imported notes also receive a
persisted synthesis recipe or streamed PCM fallback before activation. Audio-oriented interchange and
Audacity exports report when only the MIDI carrier's PCM is delivered.

DAWproject import validates and decodes before constructing the project,
persists sources before switching documents, and removes newly persisted bodies
if the switch fails. Channel gain, pan and mute automation and individual send
levels become absolute-sample automation lanes; held segments remain held.
Musical anchors are resolved at import and do not move with later tempo edits;
this clock conversion is reported.
Linear dB curves are sampled in linear gain to a bounded error, rather than
changing their interpolation unit. Generic Equalizer, Compressor, NoiseGate
and Limiter devices map explicitly to realtime processors when their parameters
are supported. Different DSP, unsupported ratios/gain stages and unavailable
parameter scheduling are reported. Original device/automation records remain
with the imported effect; eligible effect parameter automation targets stable
effect and element IDs. EQ, gate and limiter parameters currently lack the
engine's schedule queue and therefore retain their original curves opaquely.

Foreign plug-ins retain rack order, identity, enabled state, parameters and
embedded state in bypassed missing-effect entries. Only referenced embedded
state is read, capped at 16 MiB per state and 64 MiB per import before base64;
Reused state counts separately for each retained instance, with the same
64 MiB total preservation ceiling; external/missing/oversized state retains a
reported reference. These bytes are
foreign presets, not the native host's snapshots. No plug-in is matched by
name or instantiated by import. A compatible installed plug-in, identity check
and format-specific restore adapter are required to make foreign state live.
Scape save/reopen preserves these inert records and exact bytes. Unsupported
looping, routing, video and warp detail remain reported.

Ardour `.ardour` snapshots and SoundCraft `.scraft` JSON sessions use the shared
timeline import staging and activation boundary. Readers select active audio
playlists and retain exact cut placement and source offsets, static controls,
and fade lengths. Ardour sample and superclock values are converted to rational
seconds; beat-domain audio regions are refused before staging. Separate stereo source
files become parallel hard-panned tracks with a conversion report. Mono regions
that select the first channel of an interleaved file retain that selection;
mono and stereo regions can share the file through separate source views. Overlapping
Ardour layers remain additive cuts with a reported layering omission. SoundCraft
v0/v1 sessions retain sample-domain timing and their sequence frame rate.
`.scraftz` ZIP bundles admit bounded, unique relative members and one root
session before inflating anything, verify requested members, and read audio one
source at a time. Desktop lookup uses existing owner-scoped session and folder
grants; project paths never authorize arbitrary filesystem reads. Missing media
retains offline cuts. Track gain, mono pan, mute and send-level automation,
clip gain envelopes, bus/send routing and master controls are imported.
SoundCraft sends retain their pre/post-fader taps and mute.
Ardour pre-fader sends retain upstream active input trim. Their trim and send
automation curves are multiplied on the sample clock with bounded interpolation
error, while bypassed trim contributes unity.
Disconnected or unresolved strip outputs use silent main assignments to retain a valid editable
graph while preserving the absence of programme audio.
SoundCraft aux/master strips and arrangement folders retain their identities;
folder mute/solo stays a structural gate rather than a duplicate bus gate.
Markers, ranges, modern stepped tempo maps and bar-aligned meter changes are
retained. Alternate playlists, unsupported clocks, independent channel panners,
hardware routing and unsupported automation targets are reported. These readers and their helpers
belong to the deferred archive closure, outside the product startup graph.

SoundCraft MIDI and instrument tracks retain inline notes, channels, attack and
release velocities, program changes and supported channel controllers. Their
960-PPQ events use the session's stepped tempo map at each clip's sample origin.
Modern Ardour active MIDI playlists read single-track PPQ SMFs from `midifiles`, using
the session tempo rather than the SMF's default tempo. Beat and superclock
region positions, durations and source trims are retained across stepped tempo
changes. Tempo ramps, music-time anchors and legacy MIDI clocks are reported as
omitted. Missing or ambiguous MIDI companions retain offline edits without
inventing notes. Supported stepped tempo and meter maps also become editable
project metadata; imported notes retain their resolved sample timing.

Both readers create editable MIDI carriers with the triangle instrument and
report the instrument substitution. Generated recipes or streamed synthesis
are persisted before activation through the same helper as DAWproject; canonical
source chunk geometry comes from the persisted layout so Scape export/reopen
retains playable sources. Browser companion selection and desktop folder grants
also admit `.mid`/`.midi`. MIDI companions are bounded to 16 MiB each and 64 MiB
in total; expanded session MIDI is limited to 250,000 notes and channel events.
These same limits and persistence rules apply to referenced interchange MIDI
and AAF MIDI attachments.

The native readers follow Ardour's
[`Session` snapshots and time serialization](https://github.com/Ardour/ardour/tree/522303bf7cbfd7d74510eb96e7da0762ffa73237/libs)
and SoundCraft's pinned
[`craft-scraft-format` wire model](https://github.com/storytold/craft-libs/tree/45a8e16669e70dadb780dfbc759c882dd5b7ea1c/crates/scraft-format).
Tests use independently authored fixtures with those source structures; no
upstream implementation or plug-in state is bundled.
Run `node --import tsx scripts/audit-native-daw-import.mjs` for the pinned
upstream Ardour snapshot and an independently written Python ZIP/WAV bundle.
This optional format audit requires network access and Python 3.

Hindenburg `.nhsx` XML sessions use the same staging, offline-source and
activation boundary. The reader imports audio tracks, cuts, source trims,
static levels and mute, and reports fade-curve and pan-law conversions.
Ducking ramps, processing, transcripts, markers and Narrator authoring are
reported as omitted. See the [Hindenburg import profile](../features/hindenburg-import.md)
for the bounded reader contract and pinned public-session audit.

Native Pro Tools `.pts`, `.ptf` and `.ptx` audio sessions use the same staging,
offline-source and activation boundary. The bounded TypeScript reader accepts
the supported format-5 through format-12 block layouts, retains sample-exact
cuts and source trims, and maps channel lanes to separate tracks. Mix settings,
processing, MIDI and other unsupported authoring are reported. See the
[Pro Tools import contract and compiled-reference audit](../features/pro-tools-import.md)
for qualified fixtures and compatibility limits.

Conformance tests parse output with independently provisioned tools recorded in
`config/interchange-conformance-tools.json`. They are test inputs, not bundled
dependencies. Reader limitations do not redefine a correct file merely to
satisfy a lenient oracle. See
[`interchange-conformance.md`](../reference/interchange-conformance.md).

## Archive, consolidate, and trim

An archive checksum manifest comes from reading the finished archive, not from
copying the writer's own digest list. Verification checks every member, names
failures, distinguishes size from digest mismatches, and reports missing and
unlisted members. A streamed or unreadable archive records why evidence could
not be gathered without retroactively failing an already committed save.

Consolidation copies reachable linked originals into managed storage, verifies
the source while streaming and the copy by reading it back, then drops the link
under its compare-and-swap fence. A crash may leave collectible unreferenced
managed bytes, never a project whose only media was removed. Unreachable
originals are itemized; external media is never deleted, moved, or rewritten.

Trim-media decides which bytes survive, so it ignores render visibility: hidden
or muted references still protect media. It widens referenced ranges by handles,
merges overlapping or abutting ranges, and leaves sources unchanged when an
honest remap cannot be proved.

The current trim writer is managed-video, keyframe-aligned stream copy. It
widens starts to the preceding keyframe and may retain more, never less. Audio,
external media, unsupported containers, exact-timing-bound sources, and
relationships that cannot be remapped are reported rather than altered.

Trimmed bytes use a new content-addressed key so undo can reach the old body.
One project command updates source facts and every reference measured against
them. It refuses omitted references, timing-grid changes, and remaps across a
discarded gap, and maps against the runs actually written after keyframe
widening. Both consolidate and trim publish through the delivery-report surface
and retain their declared resume or atomic-restart semantics.
