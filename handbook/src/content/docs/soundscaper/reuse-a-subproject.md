---
title: Reuse a saved project as linked audio
description: Insert a saved project into another arrangement and follow its later edits.
diataxis: how-to
---

Insert a saved project into another arrangement and follow its later edits.

## Before you start

Save the child Soundscaper project in the same local project library. Finish its mix first. Render and commit active native plug-in processing to audio before using the background subproject renderer.

## Steps

1. Open the parent and choose **File > Subprojects**.
2. Choose the child under **Project to insert or relink**, then **Insert subproject**. Its published mix appears on a new track.
3. Select the link under **Linked subprojects** and choose **Open subproject** to edit the child. Save it, then return to the parent to hear the refreshed audio.
4. Choose **Pin current audio** to keep this revision, or **Make independent audio** to stop following the child.

## Check the result

The parent’s placement stays in position when the child updates. Play it after the refresh and check the beginning and end. A shorter child mix is padded with silence within the original published range.

## Limits and recovery

The published duration and channel layout remain fixed; insert another placement for a different range. A portable parent file includes the installed audio, but not the editable child project. Transfer the child separately and use **Relink to selected project**. Cyclic links are refused.
