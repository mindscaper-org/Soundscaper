---
title: "Edit tracks inside a collapsed folder"
description: "Cut or insert a passage across a folder’s nested tracks without expanding every track."
diataxis: how-to
---
<!-- docs-ai-provenance: {"factPacketSha256":"fd8133599ee12edc8c0a2f7e6a53c585f9fd13ede306c99a58ccfb4bb40f39c1","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"fd8133599ee12edc8c0a2f7e6a53c585f9fd13ede306c99a58ccfb4bb40f39c1","targetLocale":"en-GB"} -->

Cut or insert a passage across a folder’s nested tracks without expanding every track.

## Before you start

Create a track folder using a track’s **Track menu > Move selection into new folder**, or open an existing folder arrangement. Identify the folder whose contents should move together.

## Steps

1. Select the collapsed folder and choose **Edit > Edit folder contents > Select folder contents**. The same submenu is available from the folder context menu.
2. Drag a time range in the folder overview and check the selection start and end.
3. Choose **Cut from folder and close gap** from **Edit folder contents** to remove the passage and shift later material inside that folder.
4. Use **Insert clipboard into folder** to insert copied material, or **Undo** to reverse the operation.

## Check the result

The folder stays collapsed while its descendant tracks receive the edit. Expand it afterward to inspect the cuts and confirm that unrelated tracks outside the folder stayed in place.

## Limits and recovery

Folder edits are scoped to descendants, not automatically to the entire project. Listen across the edit with outside music or ambience to catch any intentional timing difference. Check locks and the intended folder before applying a grouped edit; save a [snapshot](/soundscaper/save-session-snapshots/) before a large structural change.
