---
title: "Match the tone of a voice recording"
description: "Learn a tonal reference and use Match EQ to bring another recording closer to it."
diataxis: how-to
---
<!-- docs-ai-provenance: {"factPacketSha256":"2b6667d165ad26e0b7420dc98e595da9045ad4ca45fdda417a37a2d3e697c0e4","model":"gpt-6-luna","modelProvider":"codex-subagent","operation":"translate","promptVersion":"docs-translate-v1","schemaVersion":1,"sourceLocale":"en","sourceSha256":"2b6667d165ad26e0b7420dc98e595da9045ad4ca45fdda417a37a2d3e697c0e4","targetLocale":"en-GB"} -->

Learn a tonal reference and use Match EQ to bring another recording closer to it.

## Before you start

Choose an audible full-frequency reference of at least a quarter second, preferably the same speaker recorded well. Have the target recording ready. This uses local processing in both browser and desktop.

## Steps

1. Select the reference and open **Effect > EQ and filters > Match EQ**. Choose **Learn reference from selection**.
2. Save the learned reference as a preset if you want to reuse this voice profile. Close the dialog.
3. Select the target, reopen Match EQ, recall the reference if needed, and choose **Analyze target**.
4. Compare **Original** and **Matched (level compensated)** with **Preview**. Adjust the correction, then choose **Apply to selection**, or **Edit as Filter Curve EQ** to edit the curve.

## Check the result

Listen at similar loudness for a closer tonal balance. The applied audio keeps its duration and channel count. **Undo** reverses the application.

## Limits and recovery

Match EQ cannot restore missing bandwidth or match performance, dynamics, room reverberation, or voice identity. Reference capture includes track effects before buses and master; the target is analysed before its track rack. Render a reference first when its desired sound depends on downstream processing.
