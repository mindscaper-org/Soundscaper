# Automatic phase correction

**Effect → Noise removal and repair → Automatic phase correction** applies a
fixed relative delay to selected stereo audio. It is a selection effect, with
the existing preview, cancellation, result persistence, and undo/redo paths.
It is unavailable as a realtime rack effect and does not use implicit all-audio
targeting. Each explicitly selected stereo target is analyzed independently.
Mono, wider channel layouts, and frequency-restricted spectral selections are
refused before publication.

The reference channel is copied unchanged. The other channel is aligned by a
fractional-sample delay with a normalized 48-tap windowed-sinc kernel; exact
integer offsets copy samples directly. Duration, channel layout, relative
levels, and timeline position remain unchanged. Source PCM is never mutated.
The correction fades over 32 samples at the usable selection boundaries, and
audio that would need samples outside the selection remains unchanged.

Analysis uses linear, DC-rejected normalized cross-correlation in up to nine
evenly spaced windows, using the shared PFFFT runtime. Windows are bounded to
about 86 ms and 32,768 frames; correlation is sinc-interpolated to resolve
fractional offsets. At least 75% of energetic windows must pass the confidence
and unique-peak checks, and their offsets must agree within half a sample.
Quiet windows, competing periodic peaks, inverted polarity, or inconsistent
offsets do not trigger a correction. Analysis samples the selection; it does
not establish the intended stereo image. Intentional timing differences can
also correlate strongly, so users should compare the result before applying.

The default reference is Left, maximum correction is 5 ms (0–10 ms), and
minimum confidence is 85% (50–100%). Confidence expresses normalized signal
similarity, rather than a probability that the stereo image is correct. Rates
from 8 kHz through 384 kHz are supported. Memory admission includes rendering,
worker transfer, output, persistence copies, and bounded analysis scratch.

Analyze and corrected preview use the same complete target as Apply; preview
playback is limited to six seconds after processing. Original and mono audition
settings affect temporary playback only and never enter effect parameters,
presets, or published PCM. Analysis reports are temporary and disappear when
the target, project, or effect parameters change.

The DSP and preview contracts are covered by
`tests/audio-editor-phase-correction.test.ts` and
`tests/audio-editor-phase-correction-preview.test.ts`. The menu, real worker,
analysis, audition, Apply, and undo/redo workflow is covered by
`tests/browser/audio-editor-phase-correction.spec.js`.
