# Audio file support regressions fixed on 2026-10-21

Each numbered entry describes one independently observable defect. The named regression test failed before its corresponding production change and passes afterwards. Codec spelling variants share an entry.

| # | User trigger | Previous effect | Fix | Regression test |
| --- | --- | --- | --- | --- |
| 1 | Import QuickTime AIFF-C `sowt`/`twos` uncompressed PCM. | Maintained PCM reader rejected the file; browser fallback could not decode otherwise ordinary PCM. | Recognize the integer codec and retain its byte order in the descriptor and chunk reader. | `file-support-aiff-regressions`: QuickTime sowt and twos |
| 2 | Import an AIFF-C `fl64` original. | Double-precision PCM was rejected. | Read big-endian IEEE float64 into the editor's float32 cache, sanitizing nonfinite values. | `file-support-aiff-regressions`: 64-bit AIFF-C |
| 3 | Import an AIFF whose SSND declares storage block alignment and end padding. | A nonzero block size prevented import. | Accept aligned storage, validate bounded end padding, expose only declared sample frames. | `file-support-aiff-regressions`: SSND block alignment |
| 4 | Import 12-bit or 20-bit AIFF integer PCM in whole-byte containers. | Nonbyte precision was rejected. | Select the rounded-up signed sample container and retain the actual precision. | `file-support-aiff-regressions`: integer precision |
| 5 | Import AIFF MARK names containing legacy single-byte accents. | Marker labels contained replacement characters. | Apply the existing AIFF UTF-8/single-byte text policy without trimming label whitespace. | `file-support-aiff-regressions`: legacy AIFF marker |
| 6 | Choose PNG/JPEG cover art from a filesystem that supplies no MIME type or an octet-stream MIME type. | Valid artwork could not be selected. | Identify the supported image format from the file bytes. | `file-support-aiff-regressions`: cover-art files |
| 7 | Import WAV cues with CSET-encoded label or note text. | Labels and notes were always decoded as UTF-8, corrupting accents. | Carry CSET through both the PCM reader and fallback marker scan. | `file-support-riff-regressions`: WAV CSET |
| 8 | Import WAV regions whose descriptions live in the standard ltxt text payload. | Region lengths survived but their names vanished. | Use ltxt text as the label when no labl label is present, respecting its code page. | `file-support-riff-regressions`: region descriptions |
| 9 | Export an album-tagged WAV for a player that reads RIFF INFO. | The album was absent from INFO even though other core fields were written there. | Read and write IPRD as album. | `file-support-riff-regressions`: INFO exports the album |
| 10 | Export metadata containing both a year and a full recording date. | Insertion order could reduce INFO's date to the year. | Prefer the explicit date alias. | `file-support-riff-regressions`: full recording date |
| 11 | Import a big-endian RIFX file through codec fallback. | Cue markers were not scanned at all. | Recognize RIFX and read chunk/cue/region integers in big-endian order. | `file-support-riff-regressions`: RIFX imports |
| 12 | Import a compressed RF64/BW64 original through codec fallback. | The fallback scan ignored its markers. | Walk the ds64 directory and resolve sentinel-sized chunks before scanning cues. | `file-support-riff-regressions`: RF64 compressed imports |

No compiled/native runtime assets or runtime closure inputs changed. A manual **Update AI assets** run is not required.
