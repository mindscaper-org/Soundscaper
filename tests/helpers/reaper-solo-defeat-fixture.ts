/* SPDX-License-Identifier: AGPL-3.0-only */
export function reaperSoloDefeatSession(solo: boolean, defeated: boolean, muted: boolean) {
	return `<REAPER_PROJECT 0.1 "7.61/linux-x86_64" 1
SAMPLERATE 48000 1
<TRACK
NAME "Solo"
MUTESOLO 0 ${solo ? 1 : 0} 0
>
<TRACK
NAME "Programme"
VOLPAN 1 -1
MUTESOLO ${muted ? 1 : 0} 0 ${defeated ? 1 : 0}
<ITEM
POSITION 0
LENGTH 0.1
<SOURCE WAVE
FILE "programme.wav"
>
>
>
>`;
}
