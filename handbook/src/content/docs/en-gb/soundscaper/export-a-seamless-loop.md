---
title: "Export a loop with its effect tails"
description: "Fold a reverb or delay tail into the beginning of a repeating audio file."
diataxis: how-to
---
<!-- docs-ai-provenance: {"factPacketSha256":"70ee9977385574f17d5b85641f92c402e911407d0a4c2cb62ccbd14f4d1a6e15","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"70ee9977385574f17d5b85641f92c402e911407d0a4c2cb62ccbd14f4d1a6e15","targetLocale":"en-GB"} -->

Fold a reverb or delay tail into the beginning of a repeating audio file.

## Before you start

Prepare an exact loop range with the desired processing. Use a lossless format such as WAV for checking the join. Keep normal playback and export levels below clipping.

## Steps

1. Select the time range that should repeat and open **File > Export audio**.
2. Choose the selected range and a suitable format, sample rate, and channel layout.
3. Enable **Render as loop** in the export settings. Export the file.
4. Import the result into a test project and listen to several repetitions, especially the boundary.

## Check the result

The exported file keeps the chosen loop duration while the rendered tail wraps into its beginning. Listen for clicks, a level bump, and a smooth reverb transition.

## Limits and recovery

Tail wrapping cannot fix an unsuitable musical cut or a discontinuous dry waveform. It differs from appending **Include effect tails up to 10 seconds**, which extends an ordinary export. Summed tails can raise peaks; reduce level or use the Limiter’s optional true peak limiting and check the delivered file. Lossy formats can introduce padding or change peaks, so verify the actual destination format too.
