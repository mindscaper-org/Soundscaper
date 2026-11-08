# CorridorKey browser fixtures

These repository-owned synthetic VP9 clips contain four 1280 × 720 frames at
4 fps, with no audio. They contain no third-party media or model output.

`cfr-colors.webm` contains opaque red, green, blue and white frames. It proves
that the actual browser decoder reads full rasters and the correct source
ordinal after forward and reverse seeks.

`keyed-alpha.webm` contains four identical red frames. Alpha is 255 for x < 400,
128 for 400 ≤ x < 800, and 0 otherwise. It is a deterministic test-only desktop
encoder response; the browser workflow validates its transparent preview,
storage admission and Undo/Redo. The fixture does not claim model accuracy.

Both clips were generated from RGBA bytes with FFmpeg 7.0.2 using
`-f rawvideo -pixel_format rgba -video_size 1280x720 -framerate 4`,
`-c:v libvpx-vp9 -lossless 1 -an`, and `-pix_fmt yuv420p` for the opaque clip or
`-pix_fmt yuva420p` for the alpha clip.

The opaque clip's original encode stored limited-range BT.601 YUV without color
declarations. It was remuxed with Mediabunny 1.55.3 to declare the authored sRGB
primaries/transfer (BT.709/IEC 61966-2-1), its actual SMPTE 170M/BT.601 matrix and
limited range in WebM, with the matching BT.601 VP9 keyframe declaration.
The four encoded frames, GOP, quarter-second timestamps and decoded YUV rasters
are preserved; only the keyframe's color declaration bits change. The complete
5,529,600-byte decoded YUV stream has SHA-256
`88c4cf0fcd23f96807fdebe3fc39ce3bbdad02baaa1f36e835b0c8a0baf90ad0`.
This removes browser matrix guessing while retaining the original four-channel
pixel and forward/reverse seek assertions.

The lossless VP9 option preserves the converted YUV samples; the preceding
8-bit limited-range RGBA-to-YUV conversion has already quantized the authored
RGB primaries. The decoder's independent RGB reference comes from the committed
YUV stream decoded by the local `@ffmpeg/core` 0.12.10 runtime, whose JavaScript
and WASM sizes/hashes are pinned in `config/ffmpeg-runtime-manifest.json`.
With the fixture written to its filesystem as `cfr-colors.webm`, the command is:

```js
core.reset();
core.setTimeout(30_000);
core.exec('-hide_banner', '-loglevel', 'error', '-threads', '1', '-filter_threads', '1',
  '-i', 'cfr-colors.webm', '-map', '0:v:0', '-frames:v', '4', '-pix_fmt', 'rgba',
  '-threads', '1', '-f', 'rawvideo', 'reference.rgba');
```

The complete 14,745,600-byte RGBA output has SHA-256
`5b3a41bc58dca28c9f92a5d5cea7e0587697d8f9152f0a8483b27a2707cdb9a7`.
Its four frame references are `[252, 0, 0, 255]`, `[0, 254, 0, 255]`,
`[0, 0, 253, 255]`, and `[253, 253, 253, 255]`. Browser decoding retains the
per-channel RGB difference bound of 4, alpha 255, full raster size and source ordinal
order `[0, 1, 2, 3, 0, 2]` through forward and reverse seeks.

The workflow runs with no hint by default and with the optional **Run Chroma Key
first** controls enabled. The desktop fixture records the exact hint settings
received through the renderer bridge. A separate native-resolution test compares
the CPU pre-pass matte with the normal WebGL Chroma Key shader, including custom
colors, softness, hard edges, and raster boundaries. Model parity for both modes
is retained separately in `evidence/framescaper-corridorkey-production-cpu-candidate.json`.

`prores-green.mov` is a repository-owned opaque green ProRes Standard fixture:
three 64 × 64 frames at 25 fps, in display-referred BT.709 SDR with no audio.
It was generated with FFmpeg 7.0.2 (`color=green:size=64x64:rate=25`,
`-frames:v 3 -c:v prores_ks -profile:v 2 -pix_fmt yuv422p10le`, BT.709 color tags).
The browser cannot decode this original; the native extraction regression verifies
all frames through the authenticated external FFmpeg fallback and bounded RGBA reads.
