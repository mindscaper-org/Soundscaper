---
title: Troubleshooting
description: Resolve common recording, storage, import, and export problems.
sidebar:
  order: 1
---

## A recording input is missing

Check operating-system and browser microphone permissions, then reopen the
device selector. For multitrack recording, make sure every armed track has an
available input assignment.

## A command is disabled

Many commands depend on the current state. Select the required project, track,
clip, or time range and try again. A feature can also be intentionally limited
to Soundscaper or Framescaper.

## An import uses too much memory

Compressed decoding and some large operations can need substantial temporary
memory even though stored project audio is chunked. Close unrelated tabs or
applications, retry with a smaller source, or use the desktop edition when
appropriate.

## A project disappeared from the browser

Confirm that you opened the same browser profile, origin, and product site.
Soundscaper and Framescaper share the library on the same `soundscaper.org`
origin, but another domain, browser profile, or cleared site store has a
different library.

If site data was cleared and no Scape project export exists, the editor has no cloud
copy to restore.

## AUP4 omitted part of the project

Read the compatibility report. AUP4 carries compatible audio editing state but
omits video and can convert or omit effects and Soundscaper-only mixing state.
Use a Scape project file — `.sscape` or `.fscape`, both of which open in either product — for complete project transfer.

## Recover a damaged Audacity project {#recover-a-damaged-audacity-project}

Open **File → Project management → Recover Audacity project**, choose the `.aup3`
or `.aup4` file, then select **Recover project file**. The same recovery is tried
when an ordinary Audacity import encounters damaged project data. Recovery
creates a new editing copy and keeps the original file unchanged.

Recovery selects a readable saved document or autosave and checks audio in
bounded ranges. If SQLite cannot read an audio block, recovery also tries its
live database page chain. Readable prefixes are retained; unreadable samples
become silence of the same duration. Recovery never guesses missing page links
or imports deleted audio from the database freelist.

Review the compatibility report for affected tracks and clips. If retained
Audacity-only clip XML would exceed the project document limits, recovery omits
that XML and original sample-block boundary hints, and reports that omission.
Editable audio, clip timing, envelopes and track state remain. Keep the original
for native-only clip fields. A project whose editable data still exceeds the
limits cannot be recovered into one editing copy.

Listen to the recovered project before relying on it. Use the existing File
menu export commands to save a new Audacity file. Keep the original and any
`-wal`, `-shm`, or `-journal` files together; recovery cannot reconstruct edits
that exist only in an unavailable journal or an unreadable project document.

## An export fails or does not play

Retry after confirming that the selected range contains playable material. For
compressed audio or video, verify that the runtime assets can load. After a
successful export, test the actual file in another player.

For unresolved problems, use **Help → Support** to contact the maintainer and
include the product, platform, browser or desktop build, steps, and exact error.
