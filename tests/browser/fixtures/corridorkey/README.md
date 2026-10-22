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
