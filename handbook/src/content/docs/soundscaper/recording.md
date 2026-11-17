---
title: Record audio
description: Give the editor input permission, choose routes, and protect a completed take.
sidebar:
  order: 3
---

## Prepare the input

1. Open the recording-device controls and choose an available input.
2. Allow microphone or capture permission when the browser asks.
3. Turn on input monitoring if you need to inspect the incoming level before
   recording.
4. Check the recording meter and adjust the device or input level to avoid
   clipping.

Browser permission is scoped to the site and device. If no input appears,
review both operating-system and browser permissions.

## Record one or several tracks

For a normal recording, use the **Record** menu or transport recording action.

Before starting a long recording, use **View → Zoom → Zoom out** until the ruler
shows the minutes of blank space you want. Recording keeps that scale, and its
cursor continues moving as new audio arrives. Right-click the timeline ruler
and enable **Scroll view to playhead** to follow the cursor beyond the visible
area; turn off **Pinned playhead** if you prefer the cursor to move across it.

For multitrack routing, choose **View → Enable multi-track recording**, arm the
tracks you want to record, and assign an input to each armed track. Recording
will not start when no available input is assigned.

To keep each recording on fresh tracks, open **Edit → Preferences →
Playback/Recording** and enable **Always record to a new track**. Normal recording
creates one new track. Multi-track recording creates a new track for each armed,
assigned input, preserving track order and moving the input assignments to the
new tracks for the next take. This preference is off by default.

Soundscaper also exposes timed, punch/count-in, loop/take, and sound-activated
recording workflows through its menus. Start with a normal take before adding
these conditions.

## Correct narration with punch-and-roll

Open the **Record** dropdown and enable **Lead-in time** to hear the preceding
passage before capture begins. The gear beside **Lead-in time** opens a duration
flyout with the standard time input and its format/unit dropdown. Until you
choose a duration, lead-in follows the existing one-bar count-in. Your chosen
duration is saved for later sessions; changing it does not enable lead-in.

After starting a normal recording, choose **Punch again** in the Record dropdown
to finish the current take, return to its original punch point, and record again
on the same tracks. You can also use it after stopping or during playback.
A selected recording range is retained for the retry; changing the current
selection does not change that range. Each completed take remains undoable.
Punch again is unavailable during scheduled, sound-activated, or loop/take capture.

## Keep recording notes

Choose **Window → Recording notes** to open the notes panel. Write take numbers,
recording conditions, or reminders; the notes are saved with the active project
and included in its `.sscape` project file.

Use the formatting buttons for **bold**, *italic*, headings, bulleted or numbered
lists, and inline code, or type Markdown directly. Choose **Preview** to read the
formatted notes and **Edit** to continue writing. Closing the panel keeps the
notes in the project.

## After the take

Stop recording and play the new clip before continuing. Wait for the project
status to report that saving is complete. For irreplaceable material, export a
rendered audio copy and a `.sscape` project rather than relying only on the
local library.
