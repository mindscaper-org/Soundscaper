# Audio engine modules

`../engine.js` is the compatibility facade for `WebAudioEditorEngine`.
Application code that creates or controls an engine should continue importing
the factory and class from that file. Its established methods are installed as
non-enumerable class-style descriptors from the focused runtime modules, so the
established string-named prototype API and `instanceof` behavior stay stable.

Pure model code and focused tests should use direct imports:

- `buffer-math.ts` for duration, transport-rate, PCM, and numeric helpers;
- `clip-schedule-plan.ts` for source resolution and deterministic clip plans;
- `clip-scheduler.ts` and `clip-gain.ts` for Web Audio scheduling;
- `project-effects.ts` for effect-rack traversal and immutable project edits;
- `effect-worklets.ts` for idempotent worklet/WASM loading;
- `effect-rack.ts` and `project-graph.ts` for graph construction and latency;
- `lifecycle.ts` for context/device ownership and terminal disposal;
- `transport-control.ts` and `transport-scheduler.ts` for transport state and
  scheduling;
- `effect-control.ts` for live rack configuration and EQ preview;
- `rendering.ts` for offline and realtime render orchestration; and
- `runtime-class.ts` and `runtime-methods.ts` for the typed compatibility
  constructor and explicit method composition.

There is intentionally no engine barrel. Direct imports keep pure planning code
independent of browser context creation and make dependency direction visible
to both human and AI-assisted changes.

MIDI edits publish an immutable, versioned score/instrument source recipe without
waiting for PCM synthesis. Source activation always streams these sources and
does not decode a whole clip or compute its waveform before accepting an edit.
MIDI carriers do not request waveform PCM windows while painting the timeline,
which would otherwise turn a zoomed-out view into a full-score render.
The ordinary chunk-stream scheduler requests 1,024-frame windows on demand and
feeds the AudioWorklet through the same clock, seek/loop range, track mixer,
effects and offline renderer as recorded audio. Built-in DSP runs in a dedicated
Worker; native instrument DSP runs in the existing isolated desktop plug-in host.
No whole-source synthesis runs on the UI thread. Exports and archive writers use
the ordinary source reader to materialize PCM when required.

`midi-demand-source.ts` owns a bounded immutable-source cache and serialized
renderer lifetime. Returned PCM is copied so transfers and callers cannot detach
or mutate cached samples. Store-local caches are bounded to 32 MiB in aggregate;
idle rendering workers are retired after read sessions release. Source generation
tokens isolate edits, undo and overlapping playback snapshots. Built-in synthesis
uses absolute source-frame phase, so arbitrary seek windows preserve the samples
of continuous rendering. A cold native seek currently replays controller and
voice history; previously rendered windows reuse the PCM cache.
Retained channel events provide sustain, volume/expression, sound-off and
controller reset, plus pitch bend with the default two-semitone range. Bend
changes integrate oscillator phase against absolute source frames; sustain
changes sounding duration without changing the authored key-release event.
The synthesis worker snapshots note geometry and expression timelines, indexes
sounding note intervals, and retains authored note accumulation order for exact
PCM. Built-in render windows remain independent and may be requested out of order.
The interval tree uses fewer than four doubles per prepared note. Existing stored
PCM sources remain readable and serve as already-rendered caches until edited.

`runtime-types.ts` documents the shared mutable host explicitly, while symbol
keys keep internal scheduling and lifecycle operations off the public string
method surface. `public-api.ts` is the single public type contract. Add public
methods there, to exactly one method map, and to `ENGINE_PUBLIC_METHOD_NAMES`;
the registry has a compile-time completeness assertion, while lifecycle and
prototype characterization tests guard terminal cleanup and runtime
compatibility.

An edit to the playing project prepares a replacement graph on the existing
audio context while the previous graph continues. Each graph owns a snapshot of
rendered clip buffers and an output gate. Once worklets, workers, and streamed
sources are ready, both gates switch at the same audio-clock boundary. The new
graph starts at the position playback will have reached at that boundary,
including loop wraps and the selected playback rate. Preparation failure leaves
the previous graph running; transport changes and newer edits cancel obsolete
candidates.

The document owner waits for fresh time/pitch PCM before submitting edited clip
geometry. Selection and metadata changes carry unfinished playback updates
forward without changing ordinary rename behavior. Stop and Pause cancel audio
preparation but still install the edited document for the next explicit Play.
