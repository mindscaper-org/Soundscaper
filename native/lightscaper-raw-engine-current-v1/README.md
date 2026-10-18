# Native RAW engine primitive

This fixed C++20 library uses the committed, hash-pinned LibRaw 0.22.2 source.
Its identity is `lightscaper-libraw-native/v1`; it never substitutes that identity
for either existing WASM runtime digest. Neutral processing returns oriented
linear sRGB RGBA16 words. The two derived profiles retain signed Float32 color,
headroom, actual orientation and exposure scale before ushort clipping.

Each call captures a private encoded input, owns its actual LibRaw instance and
retires decoder scratch before returning a move-only, explicitly wiped result.
Input is limited to 64 MiB, either side to 8192 and pixels to 16,777,216. Layout
and phase memory checks may refuse otherwise bounded inputs. There are no path,
filesystem, process-launch or arbitrary LibRaw-option APIs.

Embedded extraction preserves genuine JPEG/bitmap bytes. When LibRaw synthesizes
an EXIF block for a JPEG without one, its generated DateTime uses UTC consistently
across host timezones. Existing camera EXIF and compressed JPEG bytes remain
untouched. JPEG decoding and embedded bitmap color interpretation require a
separately qualified decoder; this primitive refuses to invent those pixels.

The disposable preview recipe
`lightscaper.native-original-preview.rgba8-nearest/v1` uses declared nearest
sampling and sRGB display transfer from an actual neutral or derived result.
It does not confer Original or Develop authority.

The shared Node fixture producer extracts the exact committed upstream archive
into a fresh test-owned directory and compiles one fixture per runner invocation.
Tests copy that authenticated executable and join each actual child and its
stdio before cleanup. The private fixture driver is not a shipping service.

All 14 focused cases passed on Linux x64 with Node 26.5.0, including all eight
rectangular orientations, independent pinned WASM comparisons, recovery and
headroom, exact preview bytes, malformed inputs and the genuine pinned CC0 CRW.
The final run explicitly used `TZ=Pacific/Auckland` and peaked at 184,492,032
bytes with no cgroup OOM event. This establishes local primitive behavior;
supervised service forwarding, target deployment and other maintained desktop
targets still require their owning implementation and qualification.

No **Update AI assets** run is required for this primitive/test addition. The
existing assistance runtime and both existing WASM closures remain unchanged.
Shipping native runtime inventory changes require a separate asset assessment.
