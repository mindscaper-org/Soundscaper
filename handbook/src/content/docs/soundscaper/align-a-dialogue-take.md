---
title: Align a replacement dialogue take
description: Fit a second performance of the same words to a reference clip.
diataxis: how-to
---

Fit a second performance of the same words to a reference clip.

## Before you start

Prepare two unlocked mono or stereo audio clips, each 0.25–30 seconds long. They need the same words and reasonably similar delivery. Render or unlink video-linked or beat-anchored material first.

## Steps

1. Open **Edit > Audio clips > Align dialogue**.
2. Choose the reference and replacement explicitly, then set alignment strength.
3. Choose **Analyze and align**. Compare **Play reference**, **Play replacement**, and **Play aligned**. Listen closely to consonants and breaths.
4. Choose **Create aligned copy** only after the result sounds right.

## Check the result

A new track contains an aligned copy at the reference’s start and duration. The originals remain available. **Undo** removes the created copy in one step. Save and reopen to keep using the rendered result without repeating analysis.

## Limits and recovery

The replacement must be between half and twice the reference duration. Alignment is acoustic and does not inspect lips or verify a transcript. Different wording, background noise, or overlapping speakers can defeat it. If analysis refuses the match, use shorter matching phrases or edit manually. Changing inputs or strength requires another analysis.
