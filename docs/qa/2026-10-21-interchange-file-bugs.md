# Interchange file bug audit — 2026-10-21

These 29 reproduced cases include 25 counted menu-reachable bugs and four
ancillary repairs. The counted cases cover the existing label import/export, caption sidecar import,
CUE import, and EDL/OTIO/FCPXML export paths. They are regression repairs to
existing menu workflows. The numbered tests live in
`tests/audio-editor-interchange-file-bugs.test.ts` (exports) and
`tests/audio-editor-interchange-text-file-bugs.test.ts` (text formats). Cases I16 and I18 repair
missing delivery diagnostics; they do not add support for transitions or restore
missing project objects. Each shared mechanism is counted once across formats. I02 and I03 require the
controller's optional lenient-import mode, I14 is an extreme integer boundary,
and I18 requires an invalid project reference; these four remain regression
coverage and are excluded from the user-reachable bug count.

| Case | Trigger and previous user effect | Repair and regression assertion |
| --- | --- | --- |
| I01 | Import a two-column TXT point label whose title is `2026`; the title became a 2026-second end time. | Interpret the second field of a two-column row as its title; assert a point at one second named `2026`. |
| I02 (ancillary) | A lenient label import contains a timestamp beyond safe sample coordinates; materialization aborted the entire import. | Validate frame representability inside recoverable row parsing; retain the following good label and report `TIME_RANGE`. |
| I03 (ancillary) | A rejected TXT row has a spectral continuation; its frequencies attached to an earlier valid label. | Bind continuations only to the immediately preceding accepted row; assert the earlier label stays unchanged. |
| I04 | A malformed TXT continuation starts `\\oops`; the importer silently discarded it. | Report `INVALID_CONTINUATION` instead of silently accepting malformed commands. |
| I05 | Export a label retaining a WebVTT identifier such as `NOTE` or `STYLE`; reimport treated the entire cue as metadata and lost it. | Replace reserved block identifiers; assert the exported cue remains importable. |
| I06 | Export a retained WebVTT identifier containing a newline, NUL, or timing arrow; the file became malformed or interpreted injected cue structure. | Replace structurally unsafe identifiers; assert the original cue text survives. |
| I07 | Import BOM-marked UTF-16 SubRip; ANSI fallback corrupted its text and NUL detection rejected the file. | Decode the explicit UTF-16 BOM first; assert German and CJK text survives. |
| I08 | Import a BOM-marked UTF-16 CUE sheet; UTF-8 decoding rejected otherwise usable metadata. | Decode the explicit BOM before normal CUE decoding; assert Unicode track titles survive. |
| I09 | Import SRT timing lines with tabs or repeated spaces around the arrow; styled-caption import rejected them. | Accept horizontal timing whitespace; assert the caption imports. |
| I10 | Subtitle cues are separated by a whitespace-only line; styled import merged them and included timing text in a caption. | Recognize whitespace separators while retaining empty-title export placeholders; assert two distinct captions in SRT and WebVTT. |
| I11 | A WebVTT cue uses standard `nbsp`, `lrm`, or `rlm` references; import rejected passive text as active content. | Decode the standard spacing and directional references; assert the exact resulting characters. |
| I12 | A WebVTT numeric reference has a valid prefix followed by garbage, such as `&#12z;`; parsing silently substituted a different character. | Validate every digit before conversion; assert malformed references are refused. |
| I13 | A generated fallback caption ID precedes a real cue named `cue-1`; fallback allocation stole the real ID. | Reserve valid source IDs before allocating replacements; assert the named caption retains its identity. |
| I14 (ancillary) | Export an FCPXML frame count whose multiplication by the rational denominator exceeds floating integer precision; the supposedly exact time changed. | Reduce with BigInt arithmetic; assert the complete exact rational at the safe frame boundary. |
| I15 | FCPXML project/media/clip names contain tabs or line breaks; XML attribute normalization changed their text on import. | Emit numeric whitespace references in attributes; assert the encoded values. |
| I16 | Export an authored transition to FCPXML; the cut-only profile dropped it without a delivery warning. | Add a scoped `fcpxml.transition-omitted` report entry. |
| I17 | An EDL media reel is named `BL`, `BLACK`, or `BARS`; CMX readers substituted black or a test pattern for the source. | Reserve generator identifiers during reel allocation and report their replacement; assert no source uses a generator name. |
| I18 (ancillary) | An OTIO/FCPXML track references a missing clip; export silently produced a shorter programme. | Preserve explicit error diagnostics for each unresolved clip reference in both export reports. |
| I19 | An EDL title/comment contains a Unicode line separator; downstream readers saw additional EDL lines. | Normalize the complete line-separator family in titles and comments; assert the separators cannot survive serialization. |
| I20 | Format sniffing recognizes dot-separated SRT times, but label parsing rejects the file it just classified. | Accept the supported comma/dot timing alternatives consistently in label and styled-caption import. |
| I21 | An SRT uses short millisecond fields, such as `,1` and `,12`; label import expanded them to 100 and 120 ms, while styled import refused them. | Read these fields as integer milliseconds, matching FFmpeg; assert 1001 and 2012 ms boundaries. |
| I22 | An FCPXML source trim is one audio sample or a frame on a different video grid; sequence-grid rounding moved its native source boundary. | Serialize exact native source times; assert `1/48000s` audio and `1/24s` video trims on a 25 fps sequence. |
| I23 | Camera media starts at 01:00:00:00 and is trimmed by one second; EDL source addresses incorrectly began at 00:00:01:00. | Add the reported camera origin and trim as exact times before conversion; assert 01:00:01:00 source in. |
| I24 | An FCPXML audio clip begins one sample into the timeline and lasts two samples; video-grid conversion moved or omitted the entire clip. | Keep audio placement/duration on the sample clock and enclose its end in the sequence extent; assert the exact position and duration survive. |
| I25 | Valid WebVTT emphasis wraps a whole-cue voice span; import rejected the supported speaker and style depending on nesting order. | Unwrap voice/emphasis in either order; assert text, speaker, and bold style survive. |
| I26 | A common SRT file uses uppercase or mixed-case HTML emphasis wrappers; caption import rejected otherwise supported styling. | Match SRT emphasis case-insensitively; assert nested bold/italic wrappers retain text and style. |
| I27 | A WebVTT file is imported as labels; the editor displayed voice/emphasis tag syntax instead of the visible cue text. | Extract plain text before decoding character references, preserving escaped literal tags; assert `Hello world <b>literal</b>`. |
| I28 | A libcue-compatible CUE sheet uses single-quoted filenames or titles; imports failed or retained quotation marks in label names. | Recognize both supported quotation forms; assert the ordinary filename, title, and performer import. |
| I29 | A libcue-compatible CUE sheet writes `INDEX 1` rather than `INDEX 01`; every track was refused as missing its start index. | Parse the numeric index value rather than comparing its zero-padded spelling; assert both track positions. |

Regression evidence was recorded before implementation in four local runs:
17 initial failing cases (the separate missing-media non-bug was removed), then
I17/I19/I20, I21/I22/I23, and I24/I25. Four additional ordinary-file failures (I26–I29) were then reproduced before
repair to replace the four ancillary cases in the counted total. The finalized
regression files have 29 passing cases, of which 25 count toward the requested
user-reachable audit. A focused suite covering the affected parsers, exporters, earlier encoding
repairs, source clocks, and passive caption behavior passed 153 tests. The named
time-conversion policy inventory was updated for the new EDL origin conversion
and FCPXML enclosing audio extent.

Format checks used the [W3C WebVTT specification](https://www.w3.org/TR/webvtt1/),
[FFmpeg's SubRip decoder](https://github.com/FFmpeg/FFmpeg/blob/master/libavformat/srtdec.c),
[libcue's string and index grammar](https://github.com/lipnitsk/libcue/blob/master/cue_scanner.l),
and the [OpenTimelineIO CMX adapter's special source handling](https://github.com/OpenTimelineIO/otio-cmx3600-adapter/blob/main/src/otio_cmx3600_adapter/cmx_3600.py).
No dependencies, runtime assets, model closures, target inventories, or generated
packaging files changed. **Update AI assets is not required.**
