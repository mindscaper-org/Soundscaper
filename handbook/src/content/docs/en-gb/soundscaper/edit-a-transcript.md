---
title: "Cut spoken audio through its transcript"
description: "Select words in a timed transcript to navigate and edit their audio."
diataxis: how-to
---
<!-- docs-ai-provenance: {"factPacketSha256":"35cf6dc5dcd0c0b08f82de0511870ac68a3552b5375fd9b5a15e3c0c1d667760","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"35cf6dc5dcd0c0b08f82de0511870ac68a3552b5375fd9b5a15e3c0c1d667760","targetLocale":"en-GB"} -->

Select words in a timed transcript to navigate and edit their audio.

## Before you start

Open a project containing speech. New transcript generation requires the desktop app, a compatible installed local model, and your explicit consent. An existing timed transcript can be used without generating it again.

## Steps

1. Open **Edit > Transcript-based editing**.
2. Choose **Generate transcript** when available and follow the model and permission prompts. Wait for the audio tracks to finish processing.
3. Click a word to navigate to its audio. Double-click a word to select it, then check the highlighted timeline range.
4. With focus in the transcript, press **Backspace** or **Delete** to remove the selected words and their associated audio. Listen to the join and use **Undo** if needed.

## Check the result

The transcript and audio edit together, and the selected passage becomes visible without changing your zoom. Save, close, and reopen the panel to continue working on the retained transcript.

## Limits and recovery

Transcription and word timing can be wrong: listen before deleting. The web editor explains that generation is desktop-only rather than downloading or running a model. A transcript is an editing aid, not a guaranteed verbatim record. Keep a [snapshot](/soundscaper/save-session-snapshots/) before substantial dialogue cuts.
