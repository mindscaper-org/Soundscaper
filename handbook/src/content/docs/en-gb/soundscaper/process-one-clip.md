---
title: "Apply realtime effects to one clip"
description: "Give one audio clip its own effect rack without processing every clip on its track."
diataxis: how-to
---
<!-- docs-ai-provenance: {"factPacketSha256":"0d37cd5c96e28ec54b0e1f2cb991c996e77e1e10a9b8583b806ac616d53a87f2","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"0d37cd5c96e28ec54b0e1f2cb991c996e77e1e10a9b8583b806ac616d53a87f2","targetLocale":"en-GB"} -->

Give one audio clip its own effect rack without processing every clip on its track.

## Before you start

Select an audio clip in Soundscaper. Clip effects are part of that clip’s processing and feed the track’s effects; track and master processing can still change what you hear.

## Steps

1. Open **Window > Clip properties** and expand **Effects**. This is the clip’s effect rack.
2. Choose **Add effect**, pick an effect, and adjust its settings. Play the clip to audition it.
3. Use the effect’s power button to compare bypassed and processed sound. Reorder or remove effects in the rack as needed.
4. Save the project, then audition the clip alongside its neighbours. Use **Undo** if the change does not help.

## Check the result

The chosen clip has its own processing while other clips retain their own settings. Listen past its end for a reverb or delay tail, and check the track rack if the combined result is too strong.

## Limits and recovery

An effect tail can outlast the clip’s source audio; check export tail options before delivery. For an Auto Duck detector, choose another suitable track; feedback loops are refused. Open the effect header’s **More options > Auto-idle** to control sleeping during silence. Disable it for timing-sensitive plug-ins. See [local processing](/help/local-processing/) for related settings.
