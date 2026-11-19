---
title: "Bring an audio session from another editor"
description: "Import supported audio edits, reconnect their media, and review conversion limits."
diataxis: how-to
---
<!-- docs-ai-provenance: {"factPacketSha256":"20d929f85abefccaba62453f8ca9bca18af93a0fc4a37fda4c3ed0084862cb85","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"20d929f85abefccaba62453f8ca9bca18af93a0fc4a37fda4c3ed0084862cb85","targetLocale":"en-GB"} -->

Import supported audio edits, reconnect their media, and review conversion limits.

## Before you start

Copy the session and its audio into an accessible folder. Supported native audio-session imports include REAPER `.rpp`, Hindenburg `.nhsx`, Pro Tools `.pts`/`.ptf`/`.ptx`, Ardour `.ardour`, SoundCraft sessions, and Audition `.sesx` or legacy `.ses`. Keep the original project.

## Steps

1. Choose **File > Open** or **File > Import**, or drop the session into the workspace.
2. In a browser, select the companion audio with the session. On desktop, grant access to the media folder when requested.
3. Open **File > Delivery Report**. Read omissions and conversions, then relink offline media where needed.
4. Listen to representative edits and fades, inspect track order and timing, and save a new Scape project.

## Check the result

The imported cuts should line up with the accessible source audio. Compare the result with a reference mix from the original editor, especially where processing, routing, or automation matters.

## Limits and recovery

Native import is an audio-edit conversion, not a promise of identical mixes. Supported details vary by format; plug-ins are not executed from the source session. REAPER uses active audio takes and omits alternate-take authoring, MIDI, routing, and plug-ins. For exchange back to another DAW, use supported interchange exports such as AES31 ADL or DAWproject rather than expecting a native session writer.
