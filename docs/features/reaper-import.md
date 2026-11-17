# REAPER project import

REAPER `.rpp` projects open through File > Open, File > Import and file drop in
both editors. Import retains audio track order and names, active takes, item
positions and lengths, source offsets, item/take gain, mute, track gain/pan/solo,
master gain/pan/mute, explicit fade lengths, ordinary markers and the initial
tempo and time signature. The project filename supplies the title.
Non-default tempo or meter retains the musical-timeline requirement: Soundscaper
can edit it; Framescaper applies its existing read-only feature compatibility
policy. A default 120 BPM, 4/4 audio edit remains writable in both products.

The shared timeline importer decodes selected companion media before activating
the document. Desktop lookup uses the existing owner-scoped session and folder
grants. Absolute paths and parent traversal remain offline reference metadata;
lookup uses only a safe basename within granted folders. Browser users select
audio alongside the project. Missing or ambiguous media retains the audio cuts
and offline sources for relinking. Failed activation removes newly staged media.

## Reader and conversion profile

The strict TypeScript reader parses bounded, line-oriented state chunks rather
than treating RPP as XML. Double, single and backtick quotes retain literal
backslashes. UTF-8 BOMs, CRLF and scientific notation are accepted. Pipe-prefixed
notes and code remain inert. The shared parser admits at most 64 MiB of text,
100,000 nonempty records and 64 nested chunks; interactive imports enforce a
32 MiB file limit before reading. Broken nesting, unterminated quotes, duplicate
consumed controls, ambiguous active takes and invalid ranges are refused.

Audio clocks map to the project sample grid. A positive stored sample rate is
used even when REAPER delegates playback to hardware; an absent or zero stored
rate uses a reported 48 kHz default. Sequence display uses a reported 30 fps
clock with a zero timecode origin. A non-unit project playback rate is refused.

Plain file-backed audio sources are accepted. Source sections and reverse,
stretched, pitch shifted and channel-remapped takes are omitted and reported,
as are items that play all takes simultaneously. Only the active take is used.
MIDI, video and generated sources, fixed-lane tracks, alternate takes and comp
authoring are omitted with reports. Empty tracks remain available.

Source looping is omitted; decoded media bounds shorten an overlong cut to one
source pass. Explicit fades use the editor curve. Automatic crossfades, item
solo overrides, take pan, phase inversion, automation, tempo changes, regions,
track playback offsets, plug-ins and routing are reported as omitted. Folder
tracks become ordinary tracks and use direct master assignments. Overlapping
cuts play additively, with a conversion report. REAPER pan laws and stereo pan
modes are replaced by the editor pan law. Imported processing is never executed.
Review File > Delivery Report after import. There is no RPP export or claim of
mix equivalence.

## Format evidence

The state vocabulary follows the independently observed
[ReaTeam state-chunk definitions](https://github.com/ReaTeam/Doc/blob/746c22eec33ecd069b6e8a10fa007833d80453c3/State%20Chunk%20Definitions).
This is community format evidence, not an official schema. Tests use authored
RPP text and generated audio. No vendor implementation or project media is bundled.

Run `node --import tsx scripts/audit-reaper-import.ts` for an optional network
audit of two commit- and SHA-256-pinned public projects from
[Perlence/rpp](https://github.com/Perlence/rpp/tree/6ea00bb6db76724d3521748b3effa7260f1ebf8e/tests/data).
These verify empty and mixed-source/FX chunk structures and omission reports;
they contain no supported audio cuts. Audio edit geometry and PCM persistence
are exercised with authored fixtures, and browser coverage checks import,
save/reload, offline open and drop in both products. Rendering equivalence
against REAPER remains unverified.
