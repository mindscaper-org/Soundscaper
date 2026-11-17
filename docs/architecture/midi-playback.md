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

## Audio transcription choices

The supported paths reuse the existing Vamp host and local ONNX runtime. They
publish ordinary editable MIDI while retaining the selected audio. The distinction
between a chord estimate and performed notes matters: Chordino supplies a dictionary
voicing of the estimated harmony, which need not reproduce the original performance.

| Open-source tool or model | Method and useful output | Integration decision |
| --- | --- | --- |
| [pYIN](https://github.com/c4dm/pyin) | YIN pitch candidates and HMM note segmentation for monophonic sources; GPL-2.0-or-later. | Convert the installed Vamp plugin's duration-bearing `notes` output. |
| [Chordino](https://github.com/c4dm/nnls-chroma) | NNLS chroma, chord templates and HMM smoothing; estimated chord notes; GPL-2.0-or-later. | Convert its explicit `chordnotes` output, preserving simultaneous notes. |
| [aubio](https://github.com/aubio/aubio) | DSP pitch/onset analysis; `aubionotes` emits pitch, onset and duration; GPL-3.0-or-later. | A possible monophonic alternative, requiring another native adapter. |
| [Basic Pitch](https://github.com/spotify/basic-pitch) | Neural polyphonic note/onset/contour estimation, best with one instrument; Apache-2.0 repository and checkpoint. | Use the pinned ONNX graph with an owned discrete-note decoder through Advanced Local Processing, after verified model publication. |
| [CREPE](https://github.com/marl/crepe) | Neural monophonic frequency and voicing confidence tracks. | Requires note segmentation in addition to a new model adapter; does not cover chords. |
| [Onsets and Frames](https://github.com/magenta/magenta/tree/main/magenta/models/onsets_frames_transcription) | Neural piano/drum transcription with velocity; upstream implementation is inactive. | A specialist option requiring a separately reviewed model and runtime. |
| [MT3](https://github.com/magenta/mt3) | Multi-instrument transcription through T5X. | Requires a new inference/export path and checkpoint review beyond the current ONNX adapter. |

These integration decisions concern runtime fit and output semantics, not a
comparative accuracy benchmark. Basic Pitch's upstream supports pitch bends;
Soundscaper's first decoder retains discrete notes and estimated velocities only.
Its publication, selection fences and GPU requirements are described in
[local assistance](local-assistance.md#catalog-and-availability).

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

Imported MIDI ports retain separate channel/controller namespaces for every
instrument engine. Library and native instruments use one isolated synth per
note-bearing destination and sum their output. Native event preparation stays
on the worker, including destination separation and seek state.

## Engines and opt-in routes

Open **Window → Piano roll (beta)**. Its existing Instrument menu offers the four
basic oscillators plus libADLMIDI and FluidSynth. The two libraries use small
original reference banks: FM operator patches and a generated harmonic SoundFont.
They are useful for comparing synthesis cost; they are not sampled acoustic GM
libraries. libADLMIDI uses its Nuked slim build without embedded game banks.
FluidSynth uses the build without libsndfile, with chorus and reverb disabled;
ordinary track effects remain available.

Desktop packages also include Surge XT 1.3.4 and Dexed 1.1.0 as VST3 instruments.
They appear in the same Instrument selector and its **Instrument settings** entry,
only for MIDI tracks. Instruments never appear in the effects manager. Surge XT
supplies wavetable and other synthesis types; Dexed supplies six-operator FM.
Instrument settings retain their editor for the selected track and instrument;
changing that owner closes the previous editor while preserving its saved MIDI state.
Authenticated app-provided plug-ins are discovered and enabled automatically;
explicit disabling and quarantine remain effective across application updates.
External instruments still require scanning and allowance in preferences.

The professional-native producer builds both pinned complete preferred-source
archives on each maintained desktop target. It builds only the instrument VST3
targets, disables automatic user-directory installation and omits Surge's FX
plug-in and standalone application. Windows ARM64 omits Surge's LuaJIT formula
oscillator; the other targets retain Lua. The recipe retains MTS support.
Surge's factory patches, skins, tuning files and wavetables have a separate
bounded, digest-authenticated resource inventory. They stay outside the VST3
bundle so each instance's authenticated bundle snapshot remains small. The
isolated peer receives one read-only factory-directory grant through a fixed
UTF-8 hex argument and sets the private `SURGE_DATA_HOME` before loading the
instrument. No renderer path or generic environment-setting API is exposed.
Framescaper packages retain only the shared effect host and JUCE effects.

The optional `node scripts/provision-midi-synths.mjs --native` Linux experiment
provisioner remains available for comparison with upstream distributions. The
installer producer builds Dexed's preferred source instead of redistributing
its upstream Linux binary, which requires GLIBC 2.43.

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
