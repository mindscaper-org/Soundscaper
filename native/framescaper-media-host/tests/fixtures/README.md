# Native media fixtures

`keyed-alpha-1280x720-4fps-4frames.webm` is repository-owned synthetic media:
four red 1280 × 720 frames at 4 fps, without audio. Alpha is 255 for x < 400,
128 for 400 ≤ x < 800, and 0 otherwise. The native regression decodes every
frame through the production libvpx session and RGBA scaler and checks every
alpha byte, including fractional coverage.

It was generated from RGBA with FFmpeg 7.0.2, using the production keying
encoder's separate color/alpha conversion:

```text
-f rawvideo -pixel_format rgba -video_size 1280x720 -framerate 4 -i pipe:0 -an
-vf split=2[c][a];[c]format=yuv420p[y];[a]alphaextract[alpha];[y][alpha]alphamerge
-c:v libvpx-vp9 -pix_fmt yuva420p -lossless 1 -auto-alt-ref 0 -b:v 0 -crf 0
-row-mt 1 -deadline good -cpu-used 4 -frames:v 4
```

The ProRes fixture beside it is likewise synthetic and contains four 64 × 36
frames at 24 fps; it is stored as base64 for portable source fixtures.
