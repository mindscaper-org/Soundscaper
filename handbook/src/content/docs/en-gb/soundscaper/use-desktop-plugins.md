---
title: "Use desktop audio plug-ins"
description: "Find, enable, and audition native effects and instruments in Soundscaper desktop."
diataxis: how-to
---
<!-- docs-ai-provenance: {"factPacketSha256":"fc4f375d65049fb921bb3c7a04239407a33132340a7eb14cd5eae22db3092c9e","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"fc4f375d65049fb921bb3c7a04239407a33132340a7eb14cd5eae22db3092c9e","targetLocale":"en-GB"} -->

Find, enable, and audition native effects and instruments in Soundscaper desktop.

## Before you start

Install a plug-in build compatible with your operating system and the supported host format. Bundled desktop plug-ins are available by default in supported packages; additional plug-ins still need discovery and any required permission.

## Steps

1. Open **Effect > Plugin Manager**. Search the list and use **Scanning & Settings** for discovery settings.
2. Select the plug-in and review its version, permission, and recovery controls. Enable it when appropriate.
3. Add an effect through **Effect > Audio Plugins** or a realtime rack. Select native instruments through the MIDI track’s instrument controls.
4. Audition playback, save a preset if useful, and save the project.

## Check the result

The intended plug-in should process sound and reload with its saved settings when the same compatible binary is available. Bypass it to compare and check export before delivery.

## Limits and recovery

Windows packages support the maintained VST2 bridging paths, including supported 32-bit plug-ins. Linux can use Windows VST3 through an installed, configured yabridge/Wine setup; this does not install or licence third-party plug-ins for you. Plug-in presets do not bundle binaries. If a plug-in fails, use its Plugin Manager recovery controls and try a compatible version before resuming work.
