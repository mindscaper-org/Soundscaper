/* SPDX-License-Identifier: AGPL-3.0-only */

/** Authored from the documented state-chunk vocabulary; contains no vendor data. */
export function reaperSession(): string {
	return `<REAPER_PROJECT 0.1 "7.61/linux-x86_64" 1
  SAMPLERATE 48000 1 0
  TEMPO 100 4 4
  PLAYRATE 1 0 0.25 4
  MASTER_VOLUME 0.75 0 -1 -1 1
  MARKER 1 0.5 "Cue" 0
  <TRACK {track-guid}
    NAME "Dialogue"
    VOLPAN 0.5 -0.5 -1 -1 1
    MUTESOLO 0 0 0
    ISBUS 0 0
    MAINSEND 1 0
    <ITEM
      POSITION 0.5
      LENGTH 0.5
      LOOP 0
      ALLTAKES 0
      FADEIN 1 0.01 0
      FADEOUT 1 0.02 0
      MUTE 0 0
      NAME "Phrase"
      VOLPAN 0.5 0 0.5 -1
      SOFFS 0.25
      PLAYRATE 1 1 0 -1 0 0.0025
      CHANMODE 0
      <SOURCE WAVE
        FILE "Audio Files/voice.wav"
      >
    >
  >
>`;
}
