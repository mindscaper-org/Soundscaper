---
title: Use desktop audio plug-ins
description: Find, enable, and audition native effects and instruments in Soundscaper desktop.
diataxis: how-to
---

Find, enable, and audition native effects and instruments in Soundscaper desktop.

## Before you start

Install a plug-in build compatible with your operating system and the supported host format. Bundled desktop plug-ins are available by default in supported packages; additional plug-ins still need discovery and any required permission.

## Steps

1. Open **Effect > Plugin Manager**. Search the list and use **Scanning & Settings** for discovery settings.
2. Select the plug-in and review its version, permission, and recovery controls. Enable it when appropriate.
3. Add an effect through **Effect > Audio Plugins** or a realtime rack. Select native instruments through the MIDI track’s instrument controls.
4. Audition playback, save a preset if useful, and save the project.

## Play through a guitar amp

Add **OrbitAmp** from **Effect > Audio Plugins** or a track's realtime effects
rack. Open the plug-in editor and choose an amp in the **AMP** section and a
cabinet in the **CAB** section. The desktop bundle includes the factory sounds.

## Check the result

The intended plug-in should process sound and reload with its saved settings when the same compatible binary is available. Bypass it to compare and check export before delivery.

## Limits and recovery

Windows packages support the maintained VST2 bridging paths, including supported 32-bit plug-ins. Linux can use Windows VST3 through an installed, configured yabridge/Wine setup; this does not install or license third-party plug-ins for you. Plug-in presets do not bundle binaries. If a plug-in fails, use its Plugin Manager recovery controls and try a compatible version before resuming work.
