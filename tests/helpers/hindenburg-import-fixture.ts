/* SPDX-License-Identifier: AGPL-3.0-only */

/** Independently authored from the observed NHSX wire structure; no vendor media or plug-in state. */
export function hindenburgSession(): string {
	return `<?xml version="1.0" encoding="UTF-8"?>
<Session Version="Hindenburg PRO 2.05.2718" Samplerate="48000" Time="99:00.000">
 <Info Title="Podcast edit"/>
 <AudioPool Path="Podcast Files" Location="/old/computer">
  <File Id="1" Name="voice.wav" Duration="01.000"><MetaData OriginalPath="/old/voice.wav"/></File>
 </AudioPool>
 <Tracks>
  <Track Name="Dialogue" Volume="-6.020599913279624" Pan="0.5">
   <Region Ref="1" Name="Phrase" Start="00.500" Length="00.500" Offset="00.250" Gain="6" ClipGain="-6.020599913279624" FadeIn="00.010" FadeOut="00.020"/>
  </Track>
 </Tracks>
 <Clipboard><Group/><Group/><Group/><Group/></Clipboard>
</Session>`;
}
