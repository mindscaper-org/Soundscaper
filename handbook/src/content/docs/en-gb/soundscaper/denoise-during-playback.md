---
title: "Reduce noise during playback"
description: "Add a realtime AI denoising effect to a dialogue track."
diataxis: how-to
---
<!-- docs-ai-provenance: {"factPacketSha256":"48233da1a6a6383c3a32842c992910b81829a02ec6bf2017024cbda63dfe01d6","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"48233da1a6a6383c3a32842c992910b81829a02ec6bf2017024cbda63dfe01d6","targetLocale":"en-GB"} -->

Add a realtime AI denoising effect to a dialogue track.

## Before you start

Use Soundscaper desktop. Open **Tools > Model Manager** and install the matching realtime denoising model and runtime offered by your build. Model installation is an explicit download; a browser alone cannot run this native effect.

## Steps

1. Select the noisy dialogue track and open its realtime effects rack.
2. Choose **Add effect** and select **AI denoising (DPDFNet2)**.
3. Start playback and compare with the effect bypassed using its power button.
4. Adjust the mix around the cleaned track and audition the export before delivery. Save the project to retain the rack.

## Check the result

Noise should fall while speech remains intelligible. Check quiet consonants, breaths, and the beginning of playback. If you hear pumping or missing speech, bypass the effect and compare the original.

## Limits and recovery

This is speech denoising, not a general music-restoration effect. Playback on another computer needs the compatible model and native runtime. If the effect is unavailable, check installation and desktop support; use [offline speech restoration](/soundscaper/restore-damaged-speech/) when you need a reviewed rendered result. A model download is not proof that every recording will improve.
