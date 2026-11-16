# Automatic dialogue alignment

Soundscaper's **Edit → Audio clips → Align dialogue** compares a reference clip
with another performance of the same words. The command appears only in that
application submenu. It is absent from the clip context menu and creates no
permanent workspace controls. Both browser and desktop use deterministic local
DSP; no model, transcript, inference runtime, or network service is involved.

## Admission and review

The dialog offers unlocked, unfrozen, available mono or stereo timeline audio
clips anchored to samples. Each must contain 0.25–30 seconds at a project rate
of 8–192 kHz. Video-linked and beat-anchored clips must first be unlinked or
rendered. The replacement duration must be between half and twice the reference
duration. Inputs need not overlap on the timeline.

Analysis renders each named clip separately at the project sample rate. Clip
processing is included; track and master processing are excluded. The reference
and replacement are explicit dialog choices rather than an inference from
track order. Changing either choice or alignment strength invalidates the review.

**Analyze and align** prepares private PCM. **Play reference**, **Play replacement**,
and **Play aligned** use an isolated preview engine. **Create aligned copy**
persists the aligned PCM as a new immutable source and creates a new track and
sample-anchored clip at the reference's start and duration. Publication is one
ordinary command batch and one Undo step. Original tracks, clips, and sources
are preserved. The rendered result needs no analysis cache or model to play,
export, or reopen.

## Analysis and rendering

`dialogue-alignment-features.ts` integrates input samples onto an 8 kHz analysis
clock, then computes 24 log-mel bands and 12 gain-independent cepstral dimensions
from 256-sample Hann windows at a 10 ms hop. It chooses the strongest channel
instead of summing stereo, preserving analysis of opposite-polarity recordings.
Active-frame cepstral centering reduces fixed microphone coloration. Relative
energy gates distinguish pauses from speech; silent inputs are refused.

`dialogue-alignment.ts` owns a deterministic dynamic-time-warping path. Its three
steps constrain local source/output rates to 0.5–2.0, and a 30% duration-relative
search corridor bounds large timing excursions. At most 3,000 frames per input
need three score rows and a bounded byte backpointer table. The acoustic mismatch
is a similarity diagnostic, never a recognition probability. Poor matches fail;
uncertain matches require listening in the normal review flow. Strength blends
the path with uniform duration fitting while preserving both endpoints.

`dialogue-alignment-render.ts` drives one continuous instance of the existing,
audited StaffPad engine. Time ratios follow the path with a 20 ms smoothing
window; pitch stays unchanged. Stereo shares one processing session. Output
length is exactly the reference length; identity mappings copy PCM directly.
The waveform is rendered rather than interpreting the timing map as variable
sample playback speed. No StaffPad binary, source pin, or notice changes.

Heavy analysis and rendering run in a dedicated worker. Cancellation terminates
that worker. PCM inputs are cloned rather than detached from editor caches.
Selected input and output are bounded to short clips, keeping whole-clip memory
well below the repository's 12 GB development cap.

## Ownership and limits

The track/audio controller lazily loads the processing service. Every asynchronous
stage validates project generation, revision and task ownership. Acceptance
revalidates the same review identity. Cancellation, disposal, settings changes,
project switches and intervening edits prevent publication; failed publication
rolls back the staged source. Unmounting closes preview playback and discards
private review PCM.

Use short takes of the same words and inspect consonants and breaths. Changed
wording, different languages, strong background sound, overlapping speakers and
large delivery differences can defeat acoustic matching. The processor does not
check a transcript or inspect lips. Quality parity with commercial dialogue
aligners requires listening evaluation on representative ADR recordings.

Focused coverage is in `tests/audio-editor-dialogue-alignment*.test.ts` and
`tests/browser/audio-editor-dialogue-alignment.spec.js`.
