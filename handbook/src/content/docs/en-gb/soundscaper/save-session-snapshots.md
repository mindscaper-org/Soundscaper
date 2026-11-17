---
title: "Save and restore a session snapshot"
description: "Keep a named version of an arrangement before trying a different edit."
diataxis: how-to
---
<!-- docs-ai-provenance: {"factPacketSha256":"586a6024abb3c071bed6969c39294819701ee4a38a48352c412f72dc4fb77827","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"586a6024abb3c071bed6969c39294819701ee4a38a48352c412f72dc4fb77827","targetLocale":"en-GB"} -->

Keep a named version of an arrangement before trying a different edit.

## Before you start

Open a writable Soundscaper project with the audio you want to retain. A snapshot belongs to this project; also save a portable project file for a separate backup.

## Steps

1. Open **File > Session snapshots**.
2. Enter a **Snapshot name**, such as “Before dialogue cuts”, and choose **Create snapshot**. Close the dialog and make your edits.
3. To return to that version, reopen the dialog, select it under **Saved snapshots**, and choose **Restore snapshot**.
4. Use **Rename snapshot** to clarify a version or **Delete snapshot** to remove one you no longer need.

## Check the result

The earlier arrangement and its retained audio return. Close the dialog and play the restored section. **Undo** reverses the restoration; **Redo** restores it again.

## Limits and recovery

A snapshot is a named project state, not an external backup. It can retain audio you have removed from the current arrangement and therefore uses storage. Deleting a snapshot leaves the current arrangement in place. See [project backups](/projects-and-data/storage-backups-and-privacy/).
