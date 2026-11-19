---
title: Find effects that cost playback CPU
description: Compare realtime effect costs before deciding which processing to simplify.
diataxis: how-to
---

Compare realtime effect costs before deciding which processing to simplify.

## Before you start

Use a project with realtime effects and a representative busy passage. Measurements describe this device and workload; they are not a universal ranking of plug-ins.

## Steps

1. Open **Help > CPU profiling**.
2. Start or restart playback after opening the panel so each realtime effect can be measured.
3. Watch several updates. Compare the effect rows with the basic editor row; bypass one expensive effect and repeat the same passage.
4. Close the panel when finished and restore any processing you want to keep.

## Check the result

CPU usage can exceed a single core’s capacity: 100% represents one fully occupied CPU core. Compare CPU and elapsed processing percentages. A dash means no measurement is available, not zero cost.

## Limits and recovery

Elapsed processing time includes scheduling delays. GPU use and external helper processes are excluded, and profiling itself adds overhead. A bypassed effect is identified separately. Open an effect header’s **More options > Auto-idle** to let a suitable processor sleep during silence. Disable it for effects that need continuous timing. See [local processing](/help/local-processing/) for related settings. Always replay the same passage when comparing changes.
