---
title: Turn recorded notes into editable MIDI
description: Analyze a musical recording with Basic Pitch and keep editable notes alongside the audio.
diataxis: how-to
---

Analyze a musical recording with Basic Pitch and keep editable notes alongside the audio.

## Before you start

Use Soundscaper desktop with the published Basic Pitch model and matching runtime installed. Start with a short, clearly pitched musical selection. Keep the audio as a listening reference.

## Steps

1. Select the musical audio and open **Tools > Advanced Local Processing**.
2. Set **Operation** to **Audio to MIDI (Basic Pitch)**. Confirm any required local-processing consent and choose **Analyze**.
3. Choose **Review result**, inspect the detected notes, and choose **Accept proposal** when ready.
4. Open **Window > Piano roll (beta)**, select the new MIDI material, and correct pitches, timing, and note lengths.

## Check the result

A new MIDI track appears alongside the original audio. Choose an instrument and listen to it against the recording. **Undo** removes the accepted proposal without deleting the source audio.

## Limits and recovery

Detected notes are estimates, especially in dense mixes or noisy recordings. MIDI captures notes rather than the original timbre. Use [MIDI instruments](/soundscaper/play-midi-instruments/) for playback and **File > Export other > Export MIDI (beta)** to share notes. Recipients still need an instrument that can reproduce the intended sound.
