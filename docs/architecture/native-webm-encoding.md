# Native WebM encoding

Framescaper's packaged media host statically links libvpx 1.16.0 for VP8 and
VP9 and SVT-AV1 4.2.0 for AV1. FFmpeg 9.0.1 supplies the library adapters and
WebM muxer; no separately installed FFmpeg executable is needed for this tier.
The existing target-native producer builds Windows x64/ARM64, macOS ARM64,
and Linux x64/ARM64, records the complete source and notice closure, and stages
only verified build results into packages.

Open **File > Export other > Add to render queue** to select VP8, VP9,
VP9 with transparency, or AV1. WebM starts with **Draft (fastest)** quality;
Balanced and High trade encoding speed for compression quality. Optional audio
uses the existing Opus adapter. These choices use the ordinary V14 evaluated
RGBA carrier, cancellation, private scratch, and atomic publication path.
WebM verification runs in a newly created private output directory. The sandbox
can read that directory while the surrounding destination retains its write-only
grant; the main process publishes verified bytes with an exclusive copy and
removes the private directory.

| Codec | Implementation | Draft | Balanced | High |
| --- | --- | --- | --- | --- |
| VP8 | libvpx | realtime, speed 8, CRF 36 | good, speed 4, CRF 24 | good, speed 2, CRF 12 |
| VP9 | libvpx | realtime, speed 8, CRF 36 | good, speed 4, CRF 31 | good, speed 2, CRF 24 |
| AV1 | SVT-AV1 | preset 11, CRF 36 | preset 8, CRF 31 | preset 6, CRF 24 |

VP8 also receives a geometry- and quality-dependent target bitrate instead of
libvpx's implicit 256 kbit/s default. VP9 uses row multithreading and
geometry-dependent tile columns. libvpx uses
runtime CPU detection with x86 SIMD or ARM NEON rather than a generic C-only
target. SVT-AV1 uses its runtime SIMD dispatch on x64 and supported ARM
toolchains; Windows ARM64 currently uses its portable C implementation because
the selected MSVC toolchain cannot compile the upstream GNU-style assembly.
The build authenticates NASM on x64. SVT parallelism is limited to level 2;
libvpx uses at most eight threads. Codec selection does not imply a universal
speed ranking: footage, processor, quality, transparency, and hardware support
change the comparison.

## Transparency and CorridorKey

Only the VP9 alpha profile advertises transparency. It uses `yuva420p`,
lossless VP9 with a zero quantizer, and no alternate-reference frames. For an
RGBA carrier at the exact output geometry, alpha bytes bypass RGB-to-YUV
rounding. The host hashes every submitted alpha plane, decodes the finalized
WebM through libvpx, and verifies every plane before returning an output digest.
It writes a private, digest-bound inspection report with the actual frame
timestamps and container duration.

CorridorKey prefers this bundled profile when its exact preflight accepts the
source geometry and rate. The main process converts authenticated model frame
claims into one sequential native carrier and validates the returned output
against the native inspection report before publishing it. Unsupported
preflights may use the existing external FFmpeg path. Authentication,
cancellation, encoding, or verification failures are terminal.

The shared carrier still admits even dimensions, at most 8 MiB per RGBA frame,
and 1–30 fps. Larger or higher-rate CorridorKey inputs therefore retain their
external encoder requirement. The browser-first source decoder and its external
fallback for unsupported originals are unchanged. AV1 and ordinary VP8/VP9
delivery do not advertise alpha preservation.

## Verification

The native CTest canary encodes complete VP8, VP9, and AV1 WebM files, checks
their codec and geometry, and checks decoded VP8/VP9 frame timing and exact VP9
alpha. A linked-host Node witness checks the CorridorKey carrier, decoded-alpha
verification report, output digest, and fractional frame rates without an
external FFmpeg executable. Unit and browser tests cover the existing menu,
quality choices, closed request tuples, and provider selection.

Upstream references: [libvpx](https://github.com/webmproject/libvpx),
[SVT-AV1 4.2.0](https://gitlab.com/AOMediaCodec/SVT-AV1/-/releases/v4.2.0).
