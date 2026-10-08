---
title: Storage, backups, and privacy
description: Understand local-first storage and protect projects from browser or device loss.
sidebar:
  order: 3
---

## What local-first means

Projects, recordings, and imported media are processed and stored on your
device. The editor does not require an account or synchronize projects to a
Soundscaper service.

On the web, audio and media use the browser's origin-private file system when
available, with IndexedDB fallbacks. Soundscaper requests persistent storage,
but the browser decides whether to grant it.

## What can remove a project

- Clearing site data removes the browser's local project library.
- Private or restricted browser contexts can fall back to temporary memory.
- Browser quota and eviction policies remain authoritative.
- Removing desktop application data manually removes its local library.
- A device or storage failure can remove every local copy on that device.

Uninstalling a packaged desktop build is designed to preserve its library, but
that is not a backup strategy.

## Recover after a crash

The editor reopens its last completed local save. Edits schedule an autosave
after a short pause; changes that have not finished saving can be lost.

Soundscaper's ordinary audio recordings save checkpoints about every ten seconds.
After an interruption, **Interrupted recording** offers **Recover recording**
or **Discard recording**. Recovery puts the saved checkpoints back on their
tracks. The last unfinished checkpoint and audio waiting to be saved may be
missing. Closing the dialog keeps the saved audio; use **Record options →
Resolve interrupted recording** to reopen it. Editing remains blocked until
you choose. If storage damage makes the final saved checkpoint unreadable,
recovery keeps the intact prefix and reports the missing checkpoint. A gap
earlier in the recording requires further repair rather than silently shifting
the later audio. Loop recordings have the equivalent **Interrupted take recording**
choice for their persisted takes.

If a saved Soundscaper project cannot open, the editor offers **Project recovery**. You can
also choose **File → Project management → Recover a project**. Select a saved
version and review its proposed repairs. Recovery creates a new project copy;
it preserves the damaged original. A repair can remove unreadable media,
invalid clips or effects, and references to items that no longer exist. A
retained older version may preserve more work than repairing the latest one.
On desktop, recovery can also use up to 32 retained SQLite document snapshots
when a project body file is missing or damaged. The library catalog and startup
publication journal must still be readable.

These workflows recover data that remains readable in local storage. They do
not recover cleared storage or a failed device, and do not guarantee that a
save acknowledged immediately before a power failure reached the disk.

## Backup routine

At useful milestones and before clearing or migrating storage:

1. Wait for local saving to complete.
2. Export a Scape project file (`.sscape` or `.fscape`).
3. Export and play a rendered delivery.
4. Copy both to storage outside the editor's local data.

Use AUP4 in addition when Audacity interchange matters, not instead of the
Scape project copy.

## Documentation-site privacy

This handbook is served as static files and uses browser-local search. The V1
site does not add an analytics service or an AI/search backend.

The full [Soundscaper and Framescaper privacy policy](https://soundscaper.org/privacy/en/)
also covers application delivery, device permissions, optional downloads,
desktop update checks, and Framescaper Web VCR connections.
