---
title: "Transcript-based editing"
description: "Select speech in a transcript to navigate and ripple-edit its audio."
---

Open **Edit → Transcript-based editing** to show the transcript panel. It starts
hidden and docks at the bottom. Its panel menu can move it to another dock or
close it.

If the project has no usable transcript, choose **Generate transcript** in the
desktop app. This processes available audio clips across the project, including
muted and hidden audio. Locked tracks and missing media are excluded. The usual
local-model installation and processing consent apply; generation can be
cancelled. Completed transcripts remain in the project when a later clip fails
or processing is cancelled.

Click a word to move to that point in the waveform without changing the zoom.
Select words or a phrase to select the corresponding audio. Selecting audio
highlights the overlapping transcript text on the selected tracks.

Press **Delete** or **Backspace** while editing the transcript to remove the
selected speech. Later audio on each affected track moves earlier to close the
gap, including linked audio/video edits admitted by the timeline. This behavior
does not depend on the timeline's default deletion mode. **Undo** and **Redo**
restore the audio and the displayed transcript together.

Parakeet transcripts contain word timings. Whisper needs usable word alignment
for individual word edits; passages without it are selected as complete timed
segments. The panel displays the portions of the transcript that still belong to
the current clips, including after trimming, splitting, moving, or deleting audio.
It does not change the immutable source transcript when audio is cut.

Accepted transcripts travel with the `.scape` project and can be used in the web
editor. Generating a new transcript requires the desktop app.
