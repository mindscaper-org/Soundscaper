# MIDI playback and instrument engines

MIDI tracks retain editable notes and channel events. Edits publish an immutable
`midi-generated-v1` source recipe rather than rendering a complete audio source.
Storage schema v2 admits this record type without changing the v1 stores or
discarding existing projects, history, or PCM. Archives materialize ordinary PCM
alongside the editable carrier so the archive retains its audio fallback.

The menu-opened Vamp analyzer can publish explicit duration-bearing note outputs
through the same MIDI import action. pYIN `notes` carries Hz; Chordino
`chordnotes` carries MIDI units. `vamp-analysis-midi.ts` validates these semantics
and preserves selection-relative sample timing and polyphony. Publication rechecks
the project revision, selected range and analyzer identity, then imports at the
selection's timeline start. It creates an ordinary MIDI source and one history
entry; cancellation or stale project authority publishes nothing. Pitch contours
and chromagrams cannot be interpreted as note sequences.

## Scheduling and ownership

The existing chunk-stream scheduler requests 1,024-frame source windows, keeps
bounded lookahead, and sends PCM to its AudioWorklet. At 48 kHz each window has a
21.33 ms processing budget. Built-in oscillators, libADLMIDI and FluidSynth run on
a dedicated Worker. Native instruments run in the existing isolated desktop
host; MIDI event sorting and seek preparation run on a Worker too. No synth DSP
runs on the input/UI thread.

This follows the usual real-time model: deliver MIDI events at sample offsets
within audio processing blocks, as in
[VST3 ProcessData](https://steinbergmedia.github.io/vst3_doc/vstinterfaces/structSteinberg_1_1Vst_1_1ProcessData.html),
and request PCM from the synth as needed, as in
[FluidSynth's rendering API](https://www.fluidsynth.org/api/group__audio__rendering.html).

Source activation and timeline waveform requests do not trigger a full MIDI
render. The piano roll remains the editable note representation. Explicit audio
processing and exports can still request complete PCM through the source reader.

The store-local PCM cache is bounded to 32 MiB and uses immutable source tokens.
Callers receive copies, so transfer or mutation cannot damage cached samples.
Idle rendering instances retire after 250 ms without a read; cached PCM remains
available. Source deletion and store shutdown retire their renderers and caches.

## Seeking, loops and delivery

Live streams carry their source start frame to the reader. A cold seek restores
program/bank/controller ordering, sustain/sostenuto state and sounding keys,
then starts processing at that origin. It does not synthesize the entire past
of the clip. Chased voices restart their envelopes and phase, and previous
effect tails are not reconstructed. Loops reuse caches with the same origin.

Cache keys include the origin. Export readers and derived audio sources always
use continuous synthesis from frame zero. Consequently a live chased attack can
never replace canonical export samples. Deterministic built-in oscillator windows
retain absolute source phase and can be evaluated independently at any offset.

## Engines and opt-in routes

Open **Window → Piano roll (beta)**. Its existing Instrument menu offers the four
basic oscillators plus libADLMIDI and FluidSynth. The two libraries use small
original reference banks: FM operator patches and a generated harmonic SoundFont.
They are useful for comparing synthesis cost; they are not sampled acoustic GM
libraries. libADLMIDI uses its Nuked slim build without embedded game banks.
FluidSynth uses the build without libsndfile, with chorus and reverb disabled;
ordinary track effects remain available.

Surge XT and Dexed use **Effect → Plugin Manager** and the existing native MIDI
instrument assignment/state workflow. Scan and allow the desired installation,
select a MIDI track, then assign the instrument. These native plug-ins are
user-installed and are not added to Soundscaper's installer payloads.

The optional Linux x64 setup uses exact hashes and a local Dexed source build:

```sh
node scripts/provision-midi-synths.mjs --native
# Also install into the user's normal discovery paths without overwriting an installation:
node scripts/provision-midi-synths.mjs --native --install-user
```

The upstream Dexed 1.1.0 Linux binary requires GLIBC 2.43. Building the pinned
preferred source avoids imposing that binary's libc requirement on older hosts.
The recipe disables upstream's automatic copy-after-build and installs only
through the explicit non-overwriting step. macOS, Windows and other Linux targets
use appropriate user-installed native VST3 builds through the same host.

## Reproduce measurements and audit inputs

```sh
node --import tsx scripts/performance/midi-realtime.ts
node scripts/audit-midi-synths.mjs
node scripts/provision-midi-synths.mjs --sources
```

The worker benchmark reports first-block, sustained block, cache-read, canonical
seek, live seek and main-thread event-loop timings. It exercises actual WASM
engines at 1/32/128 requested voices. Run it without competing builds to compare
results. Keep reports in ignored `private/`; they are local observations.

`scripts/performance/native-midi/` builds a benchmark against the production
professional host adapter and its pinned native SDK inputs. Its executable takes
an output JSON filename and absolute VST3 bundle paths. It reports the actual bus
topology, host latency and processing time for 128/256/1,024-frame blocks. Native
default patches can have voice limits; requested notes are not proof that every
voice remains sounding. `SOUNDSCAPER_SURGE_WAVETABLE_BENCH=1` selects Surge's first
oscillator wavetable type for a dedicated run. This measures host/DSP cost, not
the complete packaged application's device/output latency.

`config/midi-synth-runtime.json` binds runtime bytes, preferred source archives,
selected profiles and license texts. Vite exposes FluidSynth's upstream Module
and extracts its embedded WASM unchanged into a separate asset, preserving
ordinary chunk limits and CSP. No runtime evaluator or remote script loader is
introduced. Source archives retain upstream rebuild instructions; exact
byte-for-byte local reproduction of upstream prebuilt WASM is not claimed.
