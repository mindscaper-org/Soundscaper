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
