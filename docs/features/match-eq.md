# Match EQ and voice profiles

**Effect → EQ and filters → Match EQ** learns a tonal reference from one selected
clip or track range. Close the dialog, select the target recording, and reopen
Match EQ to analyze, preview, or apply a correction. Save the learned reference
with the existing preset bar to reuse a personal voice profile in other projects;
presets can also be imported and exported. Profiles store a spectrum, not PCM or
a correction curve. Every target receives a fresh analysis.

Timeline reference capture includes the selected track's effects before downstream
bus and master processing. Target analysis and application use the selection's
source signal before the track rack, like other selection effects. Source-editor
selections use source PCM. Render or commit a reference when its desired sound
depends on downstream processing.

Analysis runs in the existing selection-effect worker. It compares channel powers
without summing opposite-polarity channels, removes DC, rejects quiet windows,
normalizes window energy, and uses a trimmed mean to reduce transient outliers.
Up to 512 distributed windows and four million channel samples bound the FFT
work; profiles contain 128 logarithmically spaced frequency bands. The retained
sample rate defines supported bandwidth. Rates from 8 kHz through 384 kHz are
accepted, with at least a quarter second of audible audio.

The correction removes overall gain from the spectral difference, smooths in
octaves, limits boost and cut, and tapers at the requested frequency limits and
the narrower recording's Nyquist frequency. Quiet or unsupported bands receive
no correction. Defaults are 100% amount, half-octave smoothing, ±6 dB maximum
correction, and 80 Hz–16 kHz matching. Stereo channels share one curve to retain
their relationship. Full-spectrum selections are required; implicit all-audio
targeting is disabled.

Reference capture and target analysis process the complete selection without
publishing audio. Preview also analyzes the full selection, then auditions up to
six seconds. Original/Matched audition uses temporary RMS gain compensation;
that gain and the audition choice never enter presets or applied PCM. Reports
belong to the current document, selection, and parameters. Cancellation and
project switches cannot publish stale results.

Apply uses the existing Filter Curve EQ FIR implementation and the selection
effect's ordinary persistence and undo path. Channel count, duration, and source
PCM are preserved. **Edit as Filter Curve EQ** transfers a single analyzed
target's correction into the existing editable effect dialog. That fixed curve
can be saved or used in a realtime rack through the existing Filter Curve EQ
workflow. Match EQ itself is a selection effect, not an adaptive realtime insert.

EQ can reduce tonal differences between recordings, particularly of the same
speaker. It does not remove reverberation, restore missing bandwidth, or match
dynamics, voice identity, or performance. This feature uses local DSP and has no
model download or remote processing requirement.
