# Timecode synchronization

Soundscaper exposes an opt-in **Tools > Timecode synchronization** dialog.
The transport controller owns the live session; closing the dialog retains it,
while disabling sync, changing projects, or disposing the workspace retires it.
Settings and device IDs remain local to that workspace and are not project data.

## Protocol and timing

`timecode-sync-format.ts` reuses the sequence timecode label authority for 24,
25, 30000/1001 drop-frame, and 30 fps. Wire labels wrap at 24 hours. The offset
is timecode seconds at timeline zero: send adds it, receive subtracts it.

`timecode-mtc.ts` encodes universal realtime full-frame SysEx and quarter-frame
messages. Its bounded streaming decoder requires ordered complete cycles,
ignores interleaved realtime bytes, rejects invalid labels and reserved fields,
and applies the two-frame directional correction. Full-frame input locates
without starting playback. Output sends full-frame locates on start, stop and
discontinuity, then timestamps quarter frames against the transport clock.

`timecode-ltc.ts` implements SMPTE ST 12-1 BCD fields, sync word, polarity
correction and biphase mark audio. Fractional half-bit boundaries derive from
an absolute sample clock. The worklet sends only decoded positions to main;
the microphone never enters the program graph. LTC output has its own discrete
audio context and selected output channel, independently of program gain,
effects, rendering and export. Other output channels remain silent.

Receive chases forward positions using ordinary transport preparation and seeks
when drift exceeds two frames. It requires normal playback with loops and
recording disabled. Reverse code locates with playback stopped. A 500 ms input
timeout stops playback at its current position. Device loss stops the session.
Async device admission and transport work are fenced by a session generation.

## Platform boundary

MTC requires Web MIDI and explicit SysEx permission. Desktop admits MIDI and
SysEx only for its live trusted main Soundscaper editor. LTC requires Web Audio
worklets; input requests disable echo cancellation, noise suppression and
automatic gain. Output device selection requires AudioContext sink selection.
Select the LTC receive rate explicitly: LTC does not identify every frame rate.

This is software transport synchronization, not word clock, video genlock or
sample-clock discipline. Browser scheduling, device latency and hardware clock
drift remain physical qualification concerns. Synthetic protocol, lifecycle,
permission and browser-worklet regressions do not establish hardware accuracy.

Protocol references: [MIDI Association MTC specification](https://midi.org/midi-time-code),
[SMPTE ST 12-1](https://pub.smpte.org/pub/st12-1/st0012-1-2014.pdf), and
[Web MIDI API](https://webaudio.github.io/web-midi-api/).
