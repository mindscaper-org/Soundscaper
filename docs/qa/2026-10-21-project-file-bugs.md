# Project-file bug audit, 2026-10-21

Thirty project-file defects were reproduced with failing regression tests before
their fixes. Multiple inputs exercising one defect are counted together (CDATA
text-budget bypasses, hexadecimal numeric spellings, sequence geometry, and
cropped fades each have one entry). These changes require no manual **Update AI
assets** run: runtime source pins, build closures, and asset inventories are unchanged.

The focused regression files below are all strict TypeScript:

- `xml`: `tests/audio-editor-project-xml-input-regressions.test.ts`
- `archive`: `tests/audio-editor-project-archive-input-regressions.test.ts`
- `import`: `tests/audio-editor-dawproject-input-regressions.test.ts`
- `legacy`: `tests/audio-editor-legacy-aup-input-regressions.test.ts`
- `scope`: `tests/audio-editor-dawproject-export-scope-regressions.test.ts`

| ID | User trigger and prior effect | Fix | Regression |
| --- | --- | --- | --- |
| P01 | Open DAWproject metadata using CDATA; the title disappeared. | Append CDATA character data to the XML element text. | xml: `CDATA metadata survives import` |
| P02 | Open multibyte project XML above its document byte limit; character counting admitted too many bytes. | Measure the document's encoded UTF-8 size. | xml: `document limits measure encoded UTF-8 bytes` |
| P03 | Open an oversized multibyte or CDATA element; its independent text budget could be bypassed. | Charge UTF-8 text and CDATA against the same per-element budget. | xml: `element text limits` and `CDATA consumes the same bounded element text budget` |
| P04 | Export a clip name containing tabs or line breaks; reopening replaced them with spaces. | Encode XML attribute whitespace with character references. | xml: `clip names retain tabs and newlines` |
| P05 | Export a name containing an unmatched UTF-16 surrogate; generated project XML was unreadable. | Remove invalid surrogate scalars while preserving supplementary characters. | xml: `removes lone UTF-16 surrogates` |
| P06 | Open a DAWproject whose silent fader is written as XML Schema `-INF`; import failed. | Accept standard infinity spellings in numeric XML parameters. | xml: `negative infinity imports as a silent decibel fader` |
| P07 | Open XML using JavaScript-only numeric syntax such as `0x10`; timestamps silently became different values. | Require decimal XML number syntax. | xml: `hexadecimal literals are refused` |
| P08 | Open an archive containing `audio/take.wav` and `./audio/take.wav`; arbitrary media won. | Reject duplicate normalized member names. | archive: `duplicate normalized DAWproject entry paths` |
| P09 | Resolve an inexact-case path against two differently cased members; the first member won. | Refuse ambiguous case fallbacks while retaining exact matches. | archive: `case-insensitive media fallback refuses ambiguous entries` |
| P10 | Open an archive with corrupted stored audio; its ZIP CRC was not checked and changed samples could decode. | Verify member signatures on XML, Blob, and temporary-file reads. | archive: `corrupted embedded audio is rejected by its ZIP CRC` |
| P11 | Open invalid UTF-8 metadata; replacement characters silently changed project text. | Decode project XML with a fatal UTF-8 decoder. | archive: `invalid UTF-8 metadata is rejected` |
| P12 | Release temporary `Take.wav` while `take.wav` was also open; both files were removed. | Track temporary files by their actual member identity. | archive: `releasing temporary media preserves a different entry` |
| P13 | Open duplicate DAWproject IDs; clip references and automation could resolve to unrelated elements. | Reject duplicate IDs before building the arrangement. | import: `duplicate DAWproject IDs fail` |
| P14 | An external and embedded audio reference shared a path; the external reference hid the embedded one. | Include reference location and media kind in discovery identity. | import: `external media with the same path does not hide` |
| P15 | Open embedded media whose filename starts or ends with spaces; path trimming made it missing. | Preserve path spelling through media discovery and timeline lookup. | import: `spaces at the edges of embedded filenames` |
| P16 | Open a clip whose source offset is beyond EOF; it became a phantom final-sample clip. | Check the real source offset against available frames. | import: `clips starting beyond source EOF are omitted` |
| P17 | Open a clip with negative source time; available samples played early. | Trim the unavailable source head and advance the timeline head proportionally. | import: `source audio before file origin is trimmed` |
| P18 | All clips using an embedded source ended before arrangement origin; unused audio remained in the project and storage bindings. | Retain and report sources only after a playable clip is built. | import: `audio belonging only to clips before arrangement origin` |
| P19 | Tempo automation had successive points at one beat; the first value incorrectly won. | Apply the final authored point at each beat. | import: `final tempo point at a duplicate beat` |
| P20 | Meter automation had successive points at one beat; the first meter incorrectly won. | Apply the final authored meter at each position. | import: `final time-signature point at a duplicate bar` |
| P21 | A beat-based fade-out crossed a tempo change; its length was measured at the clip head. | Measure fade-out beats backwards from the clip tail. | import: `beat-based fade-outs use the tempo at the clip tail` |
| P22 | Open an empty legacy AUP audio track; conversion deleted the track. | Preserve audio tracks that have no clips. | legacy: `empty legacy AUP audio tracks remain available` |
| P23 | Open non-overlapping legacy AUP clips serialized out of time order; unnecessary tracks were created. | Sort clips by timeline position before assigning overlap lanes. | legacy: `out-of-order legacy AUP clips do not become unnecessary separate tracks` |
| P24 | Open linked legacy stereo channels at different rates; the right channel was played at the left channel's rate. | Reject inconsistent linked-channel rates before decoding blocks. | legacy: `stereo channels with unequal sample rates` |
| P25 | Cancel a legacy AUP import while decoding; it could still convert and switch projects. | Carry cancellation and operation ownership through every awaited import stage. | legacy: `cancelling legacy AUP while decoding prevents conversion and project publication` |
| P26 | Export one sequence of a multi-sequence project; tracks assigned to other sequences leaked into the archive. | Exclude tracks owned only by other sequences from structural fallback. | scope: `includes only tracks assigned to the selected sequence` |
| P27 | Export one sequence; cues and legacy labels from unrelated sequences appeared in the arrangement. | Scope timeline markers and label tracks to the selected structure and sequence. | scope: `excludes timeline markers belonging to other sequences` |
| P28 | Open signature automation positioned in seconds; changes were interpreted as beats and moved to wrong bars. | Resolve seconds through the imported tempo map before placing meter changes. | scope: `seconds-based time signatures resolve through the imported tempo map` |
| P29 | Open a damaged legacy AUP with inconsistent block offsets or declared length; audio silently shifted or changed duration. | Validate contiguous sequence geometry and declared frame totals before materialization. | legacy: `rejects inconsistent block positions and declared sequence lengths` |
| P30 | Import cropped DAWproject clips; a head crop restarted fades and a source-EOF crop moved later fades earlier. | Preserve the authored fade gain over retained frames with a clip envelope. | import: `retained head` and `does not move its later fade-out earlier` |

Validation: every new regression was observed failing before its fix; the related
DAWproject, SESX, legacy AUP, and XML suites pass. Targeted ESLint checks pass.
The root audit runs the canonical repository checks, full Node suite, build, and
browser checks for the combined change set.
