---
title: Render an ADM programme for speakers
description: Export authored ADM beds and objects as ordinary speaker audio using EBU EAR.
diataxis: how-to
---

Export authored ADM beds and objects as ordinary speaker audio using EBU EAR.

## Before you start

Author an ADM programme in the Metadata editor’s ADM tab, with bed assignments and positioned objects. Know your delivery speaker layout and choose a container and codec that can carry its channel count.

## Steps

1. Open **File > Export audio**.
2. Under **Rendering > EBU EAR speaker rendering**, choose a layout: stereo, 5.1, 5.1.2, 5.1.4, 7.1, or 7.1.4.
3. Check the output format, channel count, and level settings, then export.
4. Read the delivery report and audition the exported file through the matching speaker layout.

## Check the result

The output contains rendered speaker PCM in the declared channel order. This export choice does not change project monitoring or the original ADM authoring. Inspect the report for the renderer and layout used.

## Limits and recovery

EAR speaker rendering and headphone rendering cannot be combined. Split outputs and BW64/ADM passthrough cannot use this option. Rendered channels do not carry the original bed/object ADM metadata; use unrendered BW64 for that interchange. Moving or diffuse objects, HOA, bass management, and certified Dolby rendering are outside this feature. The ordinary loudness meter supports at most eight delivered channels.
