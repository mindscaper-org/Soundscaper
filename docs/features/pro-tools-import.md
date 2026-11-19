# Native Pro Tools audio-session import

File > Open, File > Import, and workspace drop routing accept `.ptx`, `.ptf`
and `.pts` session files. The reader handles the native block layouts numbered
5 through 12, including byte-indexed and page-indexed XOR and both byte orders.
This is an audio-edit import profile. It is not a Pro Tools runtime, AAX host,
full session backup, or native session writer. Save imported work as Scape.

## Reading and publication

`protools-binary.ts` verifies the file signature and XOR scheme before parsing,
copies caller-owned bytes before deobfuscation, and bounds the block tree to
64 MiB, 100,000 blocks and 64 nested levels. Strings are limited to 4 KiB and
field reads stay within their containing blocks. Integers outside JavaScript's
safe range and unsupported session versions are refused. Count mismatches in
file and region tables cannot silently renumber later source references.

`protools-audio.ts` reads the audio file table and region definitions.
`protools-tracks.ts` resolves channel indexes and region placements. Variable
width region values are little-endian even in a big-endian session; placement
and table fields use the session byte order. Sample positions, source offsets
and lengths become exact rational seconds before the existing timeline builder
maps them to project and decoded-source sample rates. Playback does not depend
on a guessed tempo. The imported sequence uses a reported 30 fps, zero-origin
display clock.

Audio channel lanes become separate tracks. Stereo lanes are hard-panned left
and right; larger layouts retain their lanes with a reported conversion and
neutral pan. Empty audio lanes remain empty. The audio placement table selects
the imported cuts; the reader does not create clips from every unused region
definition. A source missing from the file table retains an offline edit.
Unsupported, empty or unavailable region definitions are omitted with the
placement recorded in the report; other clip positions do not shift.

The shared interchange service decodes selected browser companion files or
uses existing desktop session/folder capabilities to locate `Audio Files/`
media. Session bytes never authorize arbitrary filesystem reads. Sources are
staged before activation, and failed activation removes newly staged bodies.
The readers stay in the deferred archive closure, outside product startup.

## Compatibility limits

Review File > Delivery Report after import. Track and clip gain, authored pan,
mute/solo, plug-ins, automation, routing, fades, crossfades, MIDI, tempo, meter,
markers and sequence timecode are outside this profile. Cuts use neutral
controls, with the stereo lane mapping described above. Rendered fade regions
are omitted. Unsupported grouped/compound regions are reported; this reader
does not claim that their authoring can be flattened faithfully. Missing or
undecodable audio remains offline for relinking. Source codec support still
depends on the active browser or desktop decoder.

The maintained evidence covers format-5 PTS, format-8 PTF and format-12 PTX.
Formats 6, 7, 9, 10 and 11 share admitted layouts but have no independent
fixture in the pinned corpus. A later application version is not automatically
qualified merely because it uses the `.ptx` suffix.

## Format references and independent audit

Wire-layout research comes from
[`zamaudio/ptformat`](https://github.com/zamaudio/ptformat/tree/af15ee90825f59b84b9977591862cce96bb1d781),
revision `af15ee90825f59b84b9977591862cce96bb1d781`. Its authors and LGPL terms
are retained in [third-party notices](../../THIRD_PARTY_LICENSES.md#pro-tools-session-format-reference).
The TypeScript reader and ordinary test fixtures are independently written;
upstream C++ and session files are not distributed with the application.

Run the focused format audit with network access and a C++11 compiler:

```sh
node --import tsx scripts/audit-protools-import.mjs
```

The audit downloads digest-pinned source, license and regression session bytes,
compiles a temporary reference reader, and compares every placed audio cut's
source index, position, source offset and length at the session's native sample
rate. It covers eight sessions, including PTS big-endian tables, PTF repeated
placements, PTX fades, stereo channel lanes, MXF references and a MIDI-only
session. The pinned files and expected cut counts live in the audit script.
Set `CXX` to choose the compiler. Temporary source, fixture and executable files
are removed on success or failure. This focused audit does not execute Avid Pro
Tools or establish fidelity for unsupported processing and session versions.
