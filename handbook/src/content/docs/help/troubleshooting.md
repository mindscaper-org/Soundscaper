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

## Repair an AUP3 file offline {#repair-an-aup3-file-offline}

Open **File → Project management → Recover Audacity project** to recover readable
Audacity data into a new Soundscaper project. If a large project exceeds Soundscaper's
document limits, or damaged SQLite pages prevent import, the repository also
provides an offline tool that writes a fresh `.aup3` for Audacity. The recovery
dialog links to these instructions.

Close Audacity and Soundscaper before starting. Keep the original file and any
`-wal`, `-shm`, or `-journal` files together. The tool refuses active journal or
WAL data; do not delete these files to bypass that refusal. Follow the
repository's [contribution setup](https://github.com/mindscaper-org/Soundscaper/blob/main/CONTRIBUTING.md)
to install the pinned Node.js version and npm dependencies, then run from that
checkout:

```sh
npm run repair:aup3 -- '/path/damaged.aup3' '/path/recovered.aup3'
```

Use a new output filename and allow enough disk space for a second project.
Repair reads one audio block at a time rather than loading the entire file
into memory. It selects a readable saved document or autosave, preserves its
track and clip placement, copies referenced audio, and rebuilds waveform
summaries. When SQLite cannot read a block, it tries the live database page
chain and retains a readable PCM prefix. Unreadable samples become silence of
the same duration. It never guesses missing page links or imports deleted audio
from the database freelist.

The output is published only after SQLite integrity and audio references pass
validation. The adjacent `.recovery.json` report records the original SHA-256,
document choice, and sample losses with their track and clip locations. Open the
new file in Audacity and listen before relying on it. A readable recovered AUP3 can still exceed
Soundscaper's document limits; the tool does not raise those limits. It requires
a readable schema and project document, supports the maintained Audacity 3
profile and sample-block sizes, and does not reconstruct lost edits or AUP4
history.

## An export fails or does not play

Retry after confirming that the selected range contains playable material. For
compressed audio or video, verify that the runtime assets can load. After a
successful export, test the actual file in another player.

For unresolved problems, use **Help → Support** to contact the maintainer and
include the product, platform, browser or desktop build, steps, and exact error.
