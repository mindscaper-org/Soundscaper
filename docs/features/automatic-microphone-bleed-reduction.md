# Automatic microphone-bleed reduction

**Effect → Noise removal and repair → Automatic microphone-bleed reduction**
analyzes an explicitly selected time range across two to eight audio tracks.
The intended input is aligned dialogue with one microphone per person, using
mono or stereo recordings. This is an offline, deterministic operation available
in Soundscaper's browser and desktop editors; it needs no model or download.

## Authored result

The result is ordinary clip gain envelopes, not processed PCM or a realtime
sidechain graph. All changed clips publish through one `batch` command and
share one Undo operation. Source IDs, source bytes, clip timing, track controls,
effects and track automation remain unchanged. Existing clip envelopes multiply
with the generated reduction. A bounded adaptive subdivision approximates the
product of linear segments to an absolute linear-gain error below 0.0001.
Existing gain outside the selected interval is preserved.

The existing **Clip gain** tool edits the generated points. They follow the
normal envelope rules for clip movement, trimming, splitting, playback, export,
save/reopen and interchange. There is no hidden analysis asset to keep current.
Applying again compounds the reduction; undo the previous application before
trying other settings.

## Detection and transitions

The controller renders selected clips on a shared project-rate clock in
five-second blocks with 40 ms of context on either side. Detection runs in a
cancellable worker; block results are validated before use. A joint pass retains
20 ms decisions across blocks so chunk boundaries cannot reopen microphones.

The detector box-averages and decimates to approximately 4 kHz, then compares
DC-rejected 40 ms windows. It selects the strongest stereo channel rather than
summing channels, so opposite channel polarities do not hide the signal. A
microphone is eligible for reduction only when another microphone is at least
6 dB stronger and their absolute normalized correlation exceeds the configured
minimum within a ±10 ms lag search. Negative polarity is supported. Quiet,
constant, equally loud and insufficiently similar windows stay open.

The default maximum reduction is 12 dB (0–36 dB), minimum similarity is 90%
(50–100%), and fade-down duration is 80 ms (20–500 ms). Similarity is a signal
comparison, not a probability that attenuation is correct. A 120 ms hold,
20 ms opening fade and 40 ms anticipation protect transitions into independent
speech. Short detections are ignored and selection boundaries return to unity.

Independent overlapping speech generally reduces correlation and is left open.
Very quiet speech masked by strong bleed can still be mistaken for bleed;
audition the result and edit the envelopes. Different microphone responses,
reverberation, movement and clock drift can prevent reliable detection. Decisions
assume comparable recording gains; a large hardware gain
imbalance can favour the wrong microphone. Track faders are excluded from analysis.
The processor does not align recordings or separate voices inside an active
microphone. Music and microphone arrays are outside its intended use.

## Ownership and admission

`microphone-bleed.ts` owns detection and sparse curves;
`microphone-bleed-envelope.ts` owns envelope composition. The effects controller
owns rendering, task cancellation and atomic publication. The menu and dialog
are separate from DSP, and the processing service is loaded on demand.

Admission requires a positive time range and audio on every selected microphone
track. Spectral selections, locked tracks and frozen tracks are refused. Only
selected clips participate when the selection explicitly names clips. There
are at most four million microphone/window decisions and 100,000 generated
points per curve or composed clip envelope; excessive work is refused rather
than raising existing budgets. Workers receive at most eight mono/stereo
five-second inputs plus context. Analysis never holds a whole episode's PCM.

Every asynchronous boundary checks task ownership and the original project ID,
revision and generation. Cancellation or any intervening edit discards the
entire result. No envelopes publish until all tracks and clips are ready.

## Verification

Focused Node coverage lives in `tests/audio-editor-microphone-bleed.test.ts`,
`tests/audio-editor-microphone-bleed-service.test.ts` and
`tests/audio-editor-microphone-bleed-menu.test.ts`. The browser workflow is
`tests/browser/audio-editor-microphone-bleed.spec.js`; it exercises the actual
worker, menu, publication, overlap protection, Undo/Redo, reopen and manual
gain-point editing.
