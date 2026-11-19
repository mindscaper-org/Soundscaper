---
title: Motionscaper
description: Create animated compositions and retain editable motion projects locally.
sidebar:
  order: 1
---

Motionscaper is the motion graphics editor in the Scaper family. A project
contains compositions, layers, animation, and retained media. Its project file
extension is `.mscape`.

This is a development release. Start with a copy of important source material
and keep exported project archives alongside your working library.

## Start a composition {#start-a-composition}

Choose **File → New Composition**. The **Layer** menu opens text, shape,
animation, compositing, tracking, expression, and 3D scene tools. **View →
Composition Preview** opens playback; new editing surfaces appear when you
choose them from a menu.

Choose **View → Composition Canvas** to select, move, scale or rotate layers with
static 2D transforms. Animated transforms remain editable through the property
and timeline tools.

In **View → Timeline**, select existing layers to rename, enable, disable or
remove them. Renaming preserves property references and animation. Removing a
layer keeps its original media; include its dependent layers or detach their
links first. **Undo** restores removed layers. A selected footage layer also
offers an audio checkbox when its retained source contains audio.

Follow [your first motion project](/motionscaper/first-project/) to create,
animate, save, and render a composition.

## Save and deliver {#save-and-deliver}

**File → Save** publishes a saved revision. **Save Copy** exports the current
snapshot as an `.mscape` archive without publishing a new saved revision.
Imported original media and fonts travel with the archive. The **Project
Library** opens projects retained on this device.

**File → Render** offers transparent PNG frames in a TAR archive,
opaque MP4 or WebM video, and ProRes 4444 when the desktop encoder is available.
PNG sequences exclude audio. Browser video retains authored audio when its
encoder supports the requested format. Native ProRes reports its effective
color and alpha precision in the render dialog. **File → Render Queue** keeps
jobs available across dialog closes and project switches. It retains up to eight
jobs and 128 MiB of browser downloads; each download admits up to 64 MiB. Choose
a streaming file destination for larger output and remove finished jobs to
release retained downloads. If native output cleanup fails, use **Retry Output
Cleanup** in this queue. The job keeps its destination until cleanup succeeds;
you can then remove it or retry the submitted revision with a fresh destination.

## Link to Framescaper {#link-to-framescaper}

Linked compositions require the separate Framescaper 1.1 development line.
In its **File → Linked compositions** dialog, create a pairing URL. Paste it
into Motionscaper's **File → Send Composition to Framescaper** dialog, connect,
and keep the editors and bridge windows open. Later **Save** operations send
new revisions automatically; **Save Copy** does not.

Framescaper retains each accepted revision and its complete media closure for
offline use. Undo pins a prior revision until you resume updates. Changes to
output size, timing, or the audio grid require an explicit Conform review.
The desktop receiver can instead watch a saved `.mscape` file you select.

## Check desktop updates {#check-desktop-updates}

Choose **Help → Check for Updates** in the desktop app. This manual check looks
for compatible Motionscaper releases in the project's GitHub repository. Preview
versions can receive newer preview releases; stable versions receive stable
releases. Choose **View Release** to open the verified release page. The check
does not download or install an update. Browser builds omit this menu command.

## After Effects exchange {#after-effects-exchange}

**File → Import After Effects Project** opens `.aep` and `.aepx` directly in
Motionscaper. **File → Open** accepts these files too. Review the conversion
report, select any original media and font files, and acknowledge the report
before importing a new document. After Effects and bridge scripts are not
required. The original project file stays byte-for-byte intact inside the saved
Motionscaper project; embedded file paths are never opened automatically.

Compositions, solids, precompositions, supported media, transforms, numeric
animation, static vector paths and masks, and basic text with selected fonts
have editable mappings. Missing media and unsupported content are reported;
plug-ins, advanced styles, expressions and AE rendering can differ. Import
accepts projects up to 64 MiB, media up to 64 MiB each, fonts up to 16 MiB each,
and 256 MiB combined. Save and Save Copy use Motionscaper archives. Native AEP
export is not implemented.

The renderer supports SDR color and alpha with 2.5D layers, cameras, lights,
shutter sampling, and depth of field. It does not claim HDR, full 3D meshes,
advanced AI masking, or arbitrary After Effects plug-in compatibility.
