---
title: Restore damaged speech with a local model
description: Review an optional speech-restoration result before applying it to your recording.
diataxis: how-to
---

Review an optional speech-restoration result before applying it to your recording.

## Before you start

Use the desktop app and select the speech to repair. Keep the original or a snapshot. Models shown in the task depend on the published catalog and installed runtime; VoiceFixer may not be offered by your build.

## Steps

1. Open **Effect > Noise removal and repair > Enhance Dialogue**.
2. Choose a compatible **Model**. When offered, **VoiceFixer** targets speech clipping and restoration; install it explicitly through the model controls if needed.
3. Run the task, then choose **Review result** and listen to the proposed audio alongside the original.
4. Accept the proposal only if the speech improves. Check the chosen placement before applying it and save the project.

## Check the result

Listen for repaired peaks and clearer speech, but also altered vowels, breaths, and background sound. The accepted result is an audio edit you can audition and undo; rejecting or closing review does not apply it.

## Limits and recovery

VoiceFixer resynthesizes speech and can change timbre and background content. It is not a general music declipper. If it is absent from the model picker, use an offered enhancer or the ordinary [clipped-peak repair guide](/guides/cleaning-up/restore-clipped-peaks/); an unoffered model cannot be enabled merely by following these steps.
