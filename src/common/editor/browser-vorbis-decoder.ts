/* SPDX-License-Identifier: AGPL-3.0-only */

import type { BrowserContainerAudioSample } from './browser-container-audio-decode.ts';

/** Qualify the maintained native backend; other browsers retain packet decoding. */
export function admitsNativeSurroundVorbisBackend(userAgent: unknown = globalThis.navigator?.userAgent): boolean {
	return typeof userAgent === 'string' && /^Mozilla\/5\.0\s/u.test(userAgent)
		&& /\bAppleWebKit\/\d+(?:\.\d+)*\b/u.test(userAgent) && /\bSafari\/\d+/u.test(userAgent)
		&& !/\b(?:Chrome|HeadlessChrome|Chromium|Edg|OPR|Firefox|CriOS|FxiOS|iPhone|iPad|iPod)\b/iu.test(userAgent);
}

/** A successful support advertisement cannot make this backend's stalled packets usable. */
export function assertVorbisPacketDecoder(channelCount: number): void {
	if (Number.isSafeInteger(channelCount) && channelCount >= 3 && channelCount <= 8 && admitsNativeSurroundVorbisBackend()) {
		throw new RangeError('This browser cannot import this surround Vorbis source. Convert it to WAV or FLAC, or use another supported browser.');
	}
}

const CANONICAL_SIX_CHANNEL_PLANES = [0, 2, 1, 5, 3, 4] as const;

/** Firefox exposes Vorbis FL,FC,FR,BL,BR,LFE; native PCM uses FL,FR,FC,LFE,BL,BR. */
function needsVorbisSpeakerOrder(channelCount: number): boolean {
	const userAgent = globalThis.navigator?.userAgent;
	return channelCount === 6 && typeof userAgent === 'string' && /^Mozilla\/5\.0\s/u.test(userAgent)
		&& /\bGecko\/\d+\b/u.test(userAgent) && /\bFirefox\/\d+(?:\.\d+)*\b/u.test(userAgent)
		&& !/\b(?:Android|Mobile|iPhone|iPad|FxiOS|Chrome|Chromium|Edg)\b/iu.test(userAgent);
}

/** Reorder planes at the PCM boundary without copying, resampling, or changing timestamps. */
export function canonicalVorbisSamples(samples: AsyncIterable<BrowserContainerAudioSample>, channelCount: number): AsyncIterable<BrowserContainerAudioSample> {
	if (!needsVorbisSpeakerOrder(channelCount)) return samples;
	return { async *[Symbol.asyncIterator]() {
		for await (const sample of samples) {
			if (sample.numberOfChannels !== 6) { yield sample; continue; }
			yield { timestamp: sample.timestamp, duration: sample.duration, sampleRate: sample.sampleRate,
				numberOfFrames: sample.numberOfFrames, numberOfChannels: sample.numberOfChannels,
				copyTo(destination, options) {
					sample.copyTo(destination, { ...options, planeIndex: CANONICAL_SIX_CHANNEL_PLANES[options.planeIndex] ?? options.planeIndex });
				},
				close() { sample.close(); },
			};
		}
	} };
}

/** The same native decoder also backs generic-file imports outside the packet route. */
export function canonicalNativeVorbisBuffer(decoded: AudioBuffer, encoded: ArrayBuffer): AudioBuffer {
	if (!needsVorbisSpeakerOrder(decoded.numberOfChannels) || encoded.byteLength < 58) return decoded;
	const bytes = new Uint8Array(encoded, 0, 58), header = new DataView(encoded, 0, 58);
	if (String.fromCharCode(...bytes.subarray(0, 4)) !== 'OggS' || bytes[4] !== 0 || bytes[5] !== 2
		|| bytes[26] !== 1 || bytes[27] !== 30 || bytes[28] !== 1
		|| String.fromCharCode(...bytes.subarray(29, 35)) !== 'vorbis' || header.getUint32(35, true) !== 0
		|| bytes[39] !== 6 || header.getUint32(40, true) !== decoded.sampleRate) return decoded;
	const plane = (channel: number): number => CANONICAL_SIX_CHANNEL_PLANES[channel] ?? channel;
	return Object.freeze({ length: decoded.length, duration: decoded.duration, sampleRate: decoded.sampleRate,
		numberOfChannels: decoded.numberOfChannels, getChannelData: (channel: number) => decoded.getChannelData(plane(channel)),
		copyFromChannel(destination: Float32Array<ArrayBuffer>, channel: number, start = 0) { decoded.copyFromChannel(destination, plane(channel), start); },
		copyToChannel(source: Float32Array<ArrayBuffer>, channel: number, start = 0) { decoded.copyToChannel(source, plane(channel), start); },
	});
}
