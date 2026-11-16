---
title: Timecode synchronization
description: Send and receive MIDI Time Code or audio LTC in Soundscaper.
sidebar:
  order: 5
---

Open **Tools > Timecode synchronization** to connect another application or
device to Soundscaper's transport. Synchronization starts off. Closing the
dialog keeps an enabled connection running; **Disable synchronization** releases
it. Switching projects or closing the workspace also disables it. These settings
are not saved in a project file.

## Send timecode {#send-timecode}

1. Enable **Send MTC**, **Send LTC**, or both.
2. For MTC, choose **Connect MIDI devices**, grant MIDI/SysEx access, and select
   the output port. Virtual MIDI ports can connect another application.
3. For LTC, select the audio output and its channel. Use a dedicated output
   routed to the receiving device, away from monitoring speakers.
4. Select **Timecode frame rate** and **Apply synchronization**.
5. Start playback. MTC sends quarter frames while running and full-frame locates
   when the transport stops or seeks. LTC sends an audio signal while running.

LTC bypasses the project mix. Its signal is not affected by project volume or
effects and is not included in exports. Its other output channels remain silent;
select an output that does not conflict with your program-audio routing.

## Receive timecode {#receive-timecode}

1. Turn off loop playback, return playback speed to 1, and finish any recording.
2. Set **Receive timecode** to **MTC (MIDI)** or **LTC (audio)**.
3. For MTC, connect MIDI devices and choose the input port. For LTC, select the
   audio input and channel carrying the signal. Channels are numbered from 1.
4. For LTC, select the incoming signal's frame rate. MTC supplies its own rate.
5. Choose **Apply synchronization** and start the sending device.

Forward timecode positions and starts playback. A full-frame MTC locate only
moves the playhead; reverse timecode locates without playing. When timecode is
lost for half a second, Soundscaper pauses at its current position. Receiving
does not start recording or change your project content.

## Rates and offset {#rates-and-offset}

Supported rates are 24, 25, 29.97 drop-frame, and 30 fps. For example, set
**Timecode at timeline zero (seconds)** to `3600` if your timeline begins at
timecode one hour. Send adds this offset; receive subtracts it. A position before
timeline zero stays at zero without playing. Wire timecode wraps at 24 hours.

MTC needs a browser with Web MIDI and SysEx support. LTC needs audio worklets;
choosing an output device also needs audio-context device selection. Device
availability depends on the browser and operating system. This synchronizes
transport positions; it does not provide word clock, video genlock, or a shared
hardware sample clock.
