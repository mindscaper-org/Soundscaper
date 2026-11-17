---
title: Reduce spill between dialogue microphones
description: Create editable gain envelopes that turn down correlated spill on inactive microphones.
diataxis: how-to
---

Create editable gain envelopes that turn down correlated spill on inactive microphones.

## Before you start

Use two to eight time-aligned dialogue tracks, ideally one microphone per person with comparable recording gains. Select a positive time range with audio on every chosen track. Unlock and unfreeze those tracks.

## Steps

1. Select the microphone tracks and the passage to process.
2. Open **Effect > Noise removal and repair > Automatic microphone-bleed reduction**.
3. Start with the default settings and choose **Create gain envelopes**.
4. Play the passage, especially interruptions and overlapping speech. Use **Clip gain** to adjust any generated points that turn down wanted speech.

## Check the result

Gain points reduce spill while the original sources and clip positions stay available. Check each speaker’s entrances and the selection boundaries. **Undo** removes the operation; **Redo** reinstates it.

## Limits and recovery

This does not align recordings or separate voices inside an active microphone. Strong gain differences, reverberation, and quiet speech under loud bleed can cause mistakes. If trying different settings, undo the first application: applying again compounds the attenuation. Spectral selections, locked tracks, and frozen tracks cannot be processed.
