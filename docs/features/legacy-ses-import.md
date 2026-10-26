# Legacy Cool Edit / Audition SES import

The desktop edition accepts `.ses` through File → Open. The binary reader
normalizes recognized `COOLNESS` sessions into the existing Audition import
model. Audio staging, bounded media decoding, missing-media search, project
activation, rollback and renderer-scoped read capabilities use the same path
as SESX. The legacy wrapper records `ses` as the source format and includes
the binary reader's conversion and omission warnings in the Delivery Report.

## Format evidence

There is no complete vendor specification in the references below. The reader
uses published field descriptions, cross-checked between independent readers:

- [`ses2als`, `SessionFile.cpp`](https://github.com/cbush/ses2als/blob/df788e7d8dcc94737d0fd6e1badddbb5a3db37e5/SessionFile.cpp),
  which targets Cool Edit Pro 2. Commit
  `df788e7d8dcc94737d0fd6e1badddbb5a3db37e5`, source Git blob
  `5539530ba3be3c6e6ef971e2a7047cb02792d8b1`.
- [`Audio::CoolEdit`, `Settings.pm`](https://github.com/gitpan/Audio-CoolEdit/blob/b1852eb08f9fb4098215d054d3ec7c7e012c249b/CoolEdit/Settings.pm),
  which describes earlier count-prefixed session tables. Commit
  `b1852eb08f9fb4098215d054d3ec7c7e012c249b`, source Git blob
  `7d6ab9c3324b567743ceb1e99ccfb03e1a1081d1`.
- [`ses2sesx.py`](https://github.com/outhud/audition-ses-to-sesx-converter/blob/main/ses2sesx.py),
  source Git blob `e99b702bec76fe52e7a7d9030016666652b7e730`, MIT,
  copyright (c) 2026 outhud. Its format notes supplied an initial reference;
  see [the retained license](../../LICENSES/ses2sesx-MIT.txt).

The first two references are evidence about the file structure. Their source
code is not copied into Soundscaper. The Python converter is not bundled or
executed, and its synthetic record assumptions are not accepted as proof of
Cool Edit Pro 2 or Audition 3 compatibility.

## Recognized binary structure

All integer and floating-point fields are little-endian. Offsets in this table
are relative to the named body or record, not the complete file.

| Structure | Recognized fields |
| --- | --- |
| Container | `COOLNESS`, then a 32-bit size equal to the file length minus 12 |
| Chunks | Four-byte identifier, 32-bit body length, then body; `LISTFILE` has an eight-byte identifier |
| `hdr ` body | Sample rate at 0; left/right master gains at 16 and 24 |
| `trks` body | 32-bit count, then 72-, 96- or 152-byte records |
| Track record | Left/right gains at 0 and 8; flags at 16; 36-byte name at 20; mute bit 1, solo bit 2 |
| `blk ` body | 32-bit count, then 72-, 84- or 88-byte records |
| Clip record | Left/right gains at 0 and 8; timeline start at 32; length at 36; handle at 40; flags at 44; file ID at 48; one-based track at 52; source-in at 64; mute bit 4 |
| `wav ` media record | File ID at 0; format field at 4; NUL-terminated path at 8 |

The reader checks the complete declared extent and record stride, rather than
scanning arbitrary bytes for apparent chunk signatures. Media records are
read only inside `LISTFILE` or `WLST`. Byte, count, numeric and path bounds
apply before records become project data. Unknown table layouts, duplicate
core records and unresolved file-table references fail without replacing the
current project. Same-track clip overlaps are rejected: the legacy playback
order and hidden-clip settings are not decoded. Adjacent clips and clips that
overlap on separate tracks are supported.

## Fidelity and validation limits

Supported fields preserve track names, static gain, mute/solo, clip mute,
placement, source trims and master gain. Unequal left/right gains currently
become their larger static gain with centered pan and an explicit conversion
warning. Effects, envelopes, fades, loops, routing, markers, video and other
legacy settings are not fully reconstructed. Every import carries a partial
import warning; recognized unsupported feature chunks add specific warnings.
Legacy text is interpreted as Latin-1; other Windows code pages and Unicode
session variants are not decoded. Only the unpadded chunk layouts represented
by the format evidence are accepted.

Tests generate owned binary fixtures from the published field descriptions.
They cover supported record variants, sample offsets, gains, malformed sizes,
duplicate IDs, count limits, media-reference boundaries and failure cleanup.
The browser workflow imports generated PCM, exports a WAV and checks timeline
silence, source trim and static gain in the rendered samples.

No original-application `.ses` fixture or reference mixdown is included.
These checks establish the implemented subset and its bounds, not full mix
equivalence or compatibility with all Cool Edit/Audition releases. Audition 3
sessions and later binary variants require original session/media/mixdown
fixtures before broader compatibility can be claimed. Imports are one-way;
the original session and media remain the archival source.
