---
title: "Play MIDI through an instrument"
description: "Choose a synthesizer for MIDI notes and retain the editable performance."
diataxis: how-to
---
<!-- docs-ai-provenance: {"factPacketSha256":"a602eb1b31f25ec991fc89a9dcdeefe620afcc71915c03f0a6860b87c9efc542","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"a602eb1b31f25ec991fc89a9dcdeefe620afcc71915c03f0a6860b87c9efc542","targetLocale":"en-GB"} -->

Choose a synthesizer for MIDI notes and retain the editable performance.

## Before you start

Open or import MIDI, or create a new track in Soundscaper. Built-in playback choices vary from optional native instruments. Native plug-in instruments require the desktop app and the matching enabled plug-in.

## Steps

1. Choose **Tracks > Add new track > MIDI track (beta)** if you need a track.
2. Open **Window > Piano roll (beta)**. Add notes or select existing MIDI material.
3. Choose **Instrument**. For a native instrument, open **Instrument settings** to adjust its sound and save a preset.
4. Start playback, check notes and sustain, then save and reopen the project.

## Check the result

You should hear the selected instrument while the notes remain editable in the piano roll. Instrument settings and presets should return on reopen when the required plug-in is installed.

## Limits and recovery

Native instruments are offered on MIDI tracks rather than ordinary audio tracks. A saved preset does not bundle the plug-in binary or its external libraries. Bundled instruments are enabled by default on supported desktop packages; other instruments may need [Plugin Manager](/soundscaper/use-desktop-plugins/). Check playback and export on the destination machine before relying on the same timbre.
