---
title: Import and export
description: Distinguish source media, project files, interchange files, and rendered deliveries.
sidebar:
  order: 1
---

Soundscaper uses different file types for different jobs.

## Source media

Use **File → Import** for audio, video, and labels. The current editor hint lists
AUP/AUP3/AUP4, WAV, MP3, FLAC, Opus, OGG, M4A, AIFF, and WebM; additional video
containers are supported by the video import path. Availability can depend on
the active product and runtime.

Importing media adds a project-owned source. It does not make the original file
your editable project document.

Compressed audio exports and browser imports support up to one hour or 1 GB
(1,000,000,000 file bytes), whichever limit is reached first. Desktop
file selection and compressed audio import have no fixed file-size or duration
ceiling below the safe integer range. Long jobs read, encode, and save in
chunks; large browser exports require origin-private file storage and enough
free space. Large imports require enough local storage for the decoded audio.
Format structure, decoder support, and available storage can still limit an
import.

The browser tier covers MP3, MP2, FLAC, WavPack, Opus, and Ogg Vorbis. Browser
AAC/M4A support depends on the browser codec. Desktop streaming exports cover
the six bundled formats, with 24-bit FLAC and float32 lossless WavPack. Desktop
imports depend on decoder availability; large MP2 sources use the packet
decoder, while smaller MP2 sources use the utility compatibility tier.

An active job shows a progress bar even when **View → Status bar** is hidden.
Choose **Cancel** beside the bar to stop an import or audio export.

## Editable project files

- Scape (`.sscape` from Soundscaper, `.fscape` from Framescaper, and either one openable in both) is the portable, full-fidelity project format shared by Soundscaper
  and Framescaper.
- AUP3 and AUP4 are audio-only interchange with Audacity. Choose AUP3 to target
  the Audacity 3.7.9 project profile or AUP4 for the current interchange profile.
  Neither is a full backup of a mixed-media Soundscaper project; review the
  compatibility report after export.
- Adobe Audition SESX (`.sesx`) can be opened in the desktop edition to create
  a local project from its referenced audio files. Keep the original session
  and media; SESX export is not available.
- Legacy Cool Edit / Audition SES (`.ses`) can also be opened in the desktop
  edition for supported audio arrangements. Review **File → Delivery Report**
  for unsupported settings and missing media. SES export is not available.
- Ardour sessions (`.ardour`) and SoundCraft sessions (`.scraft`, or `.scraftz`
  bundles with audio) open through **File → Open** or **File → Import**. Import
  the session and its referenced audio together in the browser. Desktop can
  locate media beside the session or ask for its media folder. Imports keep
  active audio and supported MIDI playlists, clip timing and source trims, names, mute and solo,
  static gain, supported pan, and explicit fade lengths. Split stereo Ardour sources
  become left and right tracks. Missing audio stays as an offline reference.
  SoundCraft MIDI and instrument tracks retain editable notes and channel events.
  Modern Ardour MIDI playlists also import their companion `.mid` files when
  the session uses a supported stepped tempo map. Select those MIDI files with
  the session in a browser. Imported MIDI uses a triangle synthesizer; select
  a clip and open **Window → Piano roll (beta)** to edit notes or choose an instrument.
  Plug-ins, automation, routing, alternate playlists, editable tempo maps, and
  markers are outside this profile; review **File → Delivery Report** for
  conversions and omissions, including unsupported Ardour MIDI tempo ramps and
  legacy clocks. Ardour beat-domain audio regions require conversion to
  audio-time regions before import; overlapping Ardour layers
  become additive cuts and are reported. Save the imported project
  as Scape; these formats are import-only.
- Pro Tools sessions (`.ptx`, `.ptf`, `.pts`) open through **File → Open** or
  **File → Import** for supported audio-edit layouts. In a browser, import the
  session and its referenced audio together; desktop can locate the session's
  **Audio Files** folder. Imports retain track names, clip positions, source
  trims and stereo channel lanes. Missing audio stays offline. Mix settings,
  plug-ins, automation, fades, MIDI and other unsupported authoring are listed
  in **File → Delivery Report**. Review the imported cuts against the original
  session, then save as Scape. Pro Tools export is not available.
- DAWproject imports editable MIDI notes as well as audio. AAF imports MIDI
  when the exporter includes a standard MIDI attachment, either embedded or
  linked. OTIO can import referenced `.mid` and `.midi` files with their cut
  placement and source trims. In a browser, select linked MIDI files together
  with the interchange document. The original synthesizer is replaced by a
  triangle instrument; edit notes and choose an instrument through
  **Window → Piano roll (beta)**. Review **File → Delivery Report** for missing
  files, timing conversions and unsupported attachments. OMF and ADL remain
  audio-only. If an exporter supplies MIDI as a separate, unreferenced file,
  open the audio edit first, then import that MIDI file separately.

See [Project files](/projects-and-data/project-files/) for the consequences of
each choice.

## Rendered deliveries

Audio exports create files intended for listening, publishing, or further
processing. Video exports create MP4 or WebM deliveries. A rendered file does
not retain the editable timeline, routing, effects, or project history.

Consult the [reference section](/reference/) for the generated format and
product-capability tables.
