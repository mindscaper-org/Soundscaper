/* SPDX-License-Identifier: AGPL-3.0-only */
import { readFile } from 'node:fs/promises';
import { encodeDedicatedAudioPcm } from '../../src/common/editor/browser-dedicated-audio-codec.ts';

export type ArdourSourceGainLayout = 'mono' | 'split' | 'interleaved';

export function ardourSourceGainSession(layout: ArdourSourceGainLayout, gains: readonly number[]): string {
	const count = layout === 'mono' ? 1 : 2;
	const sources = Array.from({ length: count }, (_, channel) => `<Source id="${10 + channel}" name="${layout === 'split' ? channel ? 'right.flac' : 'left.flac' : 'voice.flac'}" type="audio" channel="${layout === 'interleaved' ? channel : 0}" gain="${gains[channel] ?? 1}"/>`).join('');
	return `<Session version="7002" name="Archived levels" sample-rate="48000"><Sources>${sources}</Sources><Routes><Route id="20" name="Programme" default-type="audio" audio-playlist="30"/></Routes><Playlists><Playlist id="30" name="Programme" type="audio" orig-track-id="20"><Region id="40" name="Archived audio" source-0="10" ${count === 2 ? 'source-1="11"' : ''} channels="${count}" position="0" start="0" length="4800" scale-amplitude="0.5"/></Playlist></Playlists></Session>`;
}

/** Genuine FLAC whose normalized body needs the independently serialized source peak. */
export async function ardourNormalizedFlacFiles(layout: ArdourSourceGainLayout): Promise<readonly Readonly<{ name: string; bytes: Uint8Array<ArrayBuffer> }>[]> {
	const encode = async (channels: number, right = false) => {
		const pcm = Float32Array.from({ length: 4800 * channels }, (_, index) => {
			const sign = right || channels === 2 && index % 2 === 1 ? -1 : 1;
			return sign * (Math.floor(index / channels) === 0 ? 1 : .5);
		});
		return await encodeDedicatedAudioPcm({ format: 'flac', input: new Uint8Array(pcm.buffer), frameCount: 4800,
			sampleRate: 48000, channelCount: channels, settings: { compressionLevel: 5 }, maximumOutputBytes: 1024 ** 2 },
		{ loadPayload: async (_format, url) => Uint8Array.from(await readFile(url)) });
	};
	if (layout === 'split') return [{ name: 'left.flac', bytes: await encode(1) }, { name: 'right.flac', bytes: await encode(1, true) }];
	return [{ name: 'voice.flac', bytes: await encode(layout === 'interleaved' ? 2 : 1) }];
}
