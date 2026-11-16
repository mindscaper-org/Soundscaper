# Hindenburg session import

Hindenburg `.nhsx` sessions open through File > Open, File > Import and file
drop in both editors. The bounded XML reader maps audio tracks, names, region
placement, source offsets, static gain, mute and fade lengths into the shared
timeline import model. Desktop media lookup uses the existing owner-scoped
session and selected-folder grants. Browser users select the referenced audio
alongside the session. Missing or ambiguous media retains offline cuts for
relinking. Media writes complete before document activation, and failed
activation removes newly staged sources.

## Format profile

The reader accepts the observed Lite, PRO and Narrator XML session structure,
including default and prefixed element namespaces. `AudioPool/File` IDs bind
`Tracks/Track/Region` references. Pool and file paths must be bounded relative
paths; `Location` and `MetaData/OriginalPath` never grant filesystem authority.
Seconds, minutes:seconds and hours:minutes:seconds are parsed as exact decimal
rationals, with omitted zero attributes defaulting to zero. Stored positions
round once to the project sample grid. `Session/Time` is not used as an edit
boundary. Duplicate IDs, broken references, malformed clocks, external DTDs,
entity declarations and excessive XML depth or item counts are refused.

Track `Volume` and legacy `Gain` are decibels. If both occur, `Volume` is used
and the omitted additional control is reported. Region `ClipGain` takes
precedence over `Gain`. Pan direction is reversed into the editor convention;
the different pan law and stereo behavior are reported. Fade attributes retain
their duration using the editor curve, with a conversion report. Gain limiting
and source-extent corrections use the shared importer reports.

`Fade` child elements describe volume ramps, including ducking; these envelopes
are omitted and reported rather than interpreted as fades to silence. Plug-ins,
voice profiles, unsupported track controls, metadata other than the title,
transcripts, markers, clipboard audio and Narrator manuscript/EPUB navigation are
also reported as omitted. Compound regions and regions with unrecognized
controls are omitted with a report, avoiding incorrect plain-cut playback.
The sequence display uses a reported 30 fps clock with a zero timecode origin.
No NHSX export or Hindenburg processing emulation is supplied.

## Independent evidence

The wire model is supported by independently published
[PRO measurements and format notes](https://github.com/ollisulopuisto/podcast/blob/23a634f814131543b0f587e999b9de1eff0bb48e/docs/hindenburg-nhsx-format.md),
a [Lite session fixture](https://github.com/erikras/audio-editor/blob/98160494701daef9d7875e752d88debf61addb0f/Tests/EditorCoreTests/Fixtures/sample.nhsx),
and [Narrator research sessions](https://github.com/KBNLresearch/Multimodal-Presentations/tree/293ca259ccfd9a65d77aa5291e8420c3b79d858c).
These are evidence for the imported structures, not an official vendor schema
or proof of mix equivalence. Automated tests use independently authored XML
and generated audio; no vendor code, plug-in state or reference media is bundled.

Run `node --import tsx scripts/audit-hindenburg-import.ts` to download three
commit- and SHA-256-pinned public session files and check 62 audio cuts through
the real project builder. This optional format audit requires network access.
Playback equivalence against Hindenburg reference renders remains unverified.
