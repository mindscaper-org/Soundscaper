# Speech declipping

VoiceFixer is an optional desktop speech-restoration model selected through
**Effect → Noise Removal & Repair → Enhance Dialogue → Model**. Existing
enhancement defaults remain unchanged. The model addresses clipping, noise,
reverberation and bandwidth loss together; it resynthesizes speech and can
change timbre or background content. It is not a general music declipper.

## Signal and publication boundary

The adapter accepts the existing 48 kHz channel-preserving assistance WAV.
Each channel is processed in bounded five-second windows with 50% overlap,
reflection at source boundaries and complementary linear crossfades. Owned
windowed-sinc resampling maps each window to 44.1 kHz. A centered, reflected,
periodic-Hann 2048-point STFT with a 441-sample hop feeds the pinned HTK mel
filterbank, producing one `[1, 1, 501, 128]` magnitude-mel tensor.

The authenticated ONNX analysis graph predicts log-mel values. The adapter
applies the upstream `10 ** min(value, 5)` inverse before the neural vocoder.
The exact pinned vocoder returns 223146 samples. Upstream peak restraint and
center cropping remove its padding; resampling returns exactly 240000 frames
at 48 kHz before overlap reconstruction. Finite tensor checks, cancellation,
bounded reads and transactional output cleanup apply throughout.

The standard ONNX runtime chooses authenticated CoreML/WebGPU providers and
retains CPU fallback. Both neural stages use that shared selection; the adapter
does not force CPU execution or add another runtime family. Derived audio uses
the existing consent, selection fence, placement and undo paths.

## Provenance and admission

`config/voicefixer-model-source.json` pins the identity-mirrored ONNX graphs,
mel filters, retained notices and packaged clipped-speech execution case.
`evidence/voicefixer-model-inspection.json` records actual graph structure and
filter geometry. The original Haohe Liu checkpoints are CC-BY-4.0 on Zenodo
record 5600188. Original inference code is MIT; the conversion tool is
Apache-2.0. The ONNX model card's MIT declaration does not remove the original
checkpoint attribution obligation. Complete grants and conversion credit are
retained under `LICENSES/local-models/` and `THIRD_PARTY_LICENSES.md`.

The model remains outside the offered catalog until immutable product assets
pass public HEAD, byte-range, CORS and complete SHA-256 readback. Prepare and
verify the exact candidate locally with:

```sh
node scripts/models/voicefixer-model-assets.mjs
```

The explicit publication operation uses the existing EU model-store credentials:

```sh
node scripts/models/voicefixer-model-assets.mjs --publish --write-catalog
node scripts/docs-local-models.mjs
```

Review and commit the resulting catalog, licensing row, readback receipt,
real-model case and generated model instructions together. Publication does not
prove packaged execution on every target. The packaged clipped-speech case
requires actual GPU work under the existing real-model test policy.
