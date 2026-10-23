/* SPDX-License-Identifier: AGPL-3.0-only */

import type { Input, InputAudioTrack } from 'mediabunny';
import { findAudioIdentificationPage, inspectOggGaplessGeometry } from '../../../ogg-gapless-import.ts';
import { isDesktopMainAudioCodecRuntime } from '../../../desktop-main-audio-codec-runtime-marker.ts';

const MAXIMUM_ENCODED_BYTES = 32 * 1024 ** 2;
const MAXIMUM_PCM_BYTES = 128 * 1024 ** 2;
const MAXIMUM_PACKETS = 65_536;
interface Sample { close(): void }
export interface NativeSurroundOpusAdmission {
	readonly sampleRate: number;
	readonly channelCount: number;
	readonly frameCount: number;
}

/** Some native incremental decoders advertise multistream Opus, then reject its first packet. */
export async function nativeSurroundOpusAdmission(file: Blob, options: Readonly<{
	signal?: AbortSignal;
	codecRuntime?: unknown;
	createInput?: (file: Blob) => Input;
	readFirstSample?: (track: InputAudioTrack) => Promise<Sample | null>;
}> = {}): Promise<NativeSurroundOpusAdmission | null> {
	const { signal } = options;
	signal?.throwIfAborted();
	if (isDesktopMainAudioCodecRuntime(options.codecRuntime) || file.size > MAXIMUM_ENCODED_BYTES || file.size < 27) return null;
	if (new TextDecoder().decode(await file.slice(0, 4).arrayBuffer()) !== 'OggS') return null;
	signal?.throwIfAborted();
	const identification = await findAudioIdentificationPage(file, 'opus');
	signal?.throwIfAborted();
	const header = identification?.subarray(27 + identification[26]!);
	if (!header || header.length < 19 || header[9]! < 3 || header[9]! > 8) return null;
	const { Input, BlobSource, OGG, AudioSampleSink, EncodedPacketSink } = await import('mediabunny');
	signal?.throwIfAborted();
	const input = options.createInput?.(file) ?? new Input({ source: new BlobSource(file, { maxCacheSize: 4 * 1024 ** 2, useStreamReader: false }), formats: [OGG] });
	try {
		const track = await input.getPrimaryAudioTrack();
		signal?.throwIfAborted();
		if (!track || await track.getCodec() !== 'opus') return null;
		const channelCount = await track.getNumberOfChannels();
		const sampleRate = await track.getSampleRate();
		if (channelCount < 3 || channelCount > 8 || sampleRate !== 48_000) return null;
		const geometry = await inspectOggGaplessGeometry(file, 'opus', signal);
		if (!geometry || geometry.sourceFrames * channelCount * 4 > MAXIMUM_PCM_BYTES) return null;
		try {
			const pending = options.readFirstSample?.(track) ?? (async () => {
				const timestamp = Math.max(0, await track.getFirstTimestamp());
				return new AudioSampleSink(track).getSample(timestamp);
			})();
			const sample = await firstSample(pending, signal);
			sample?.close();
			return null;
		} catch (error) {
			signal?.throwIfAborted();
			if (!(error instanceof DOMException) || error.name !== 'EncodingError') throw error;
		}
		// Authenticate the possible allocation using every encoded packet, so an
		// understated final granule cannot hide a larger native decode.
		let frames = 0, packets = 0;
		for await (const packet of new EncodedPacketSink(track).packets(undefined, undefined, { metadataOnly: true })) {
			signal?.throwIfAborted();
			const packetFrames = Math.round(packet.duration * sampleRate);
			if (++packets > MAXIMUM_PACKETS || packet.byteLength > 1024 ** 2 || packetFrames < 1
				|| packetFrames > 5760 || Math.abs(packet.duration * sampleRate - packetFrames) > 1e-5) return null;
			frames += packetFrames;
			if (frames * channelCount * 4 > MAXIMUM_PCM_BYTES) return null;
			if (packets % 64 === 0) await new Promise<void>(resolve => setTimeout(resolve, 0));
		}
		if (geometry.sourceFrames > frames || frames < 1) return null;
		signal?.throwIfAborted();
		return Object.freeze({ sampleRate, channelCount, frameCount: geometry.sourceFrames });
	} finally { input.dispose(); }
}

/** Check the native result before canonicalization, source writes, or command publication. */
export function assertNativeSurroundOpusGeometry(decoded: Readonly<{ sampleRate: number; numberOfChannels: number; length: number }>,
	admission: NativeSurroundOpusAdmission | null): void {
	if (!admission) return;
	if (decoded.sampleRate !== admission.sampleRate || decoded.numberOfChannels !== admission.channelCount
		|| decoded.length !== admission.frameCount || decoded.length * decoded.numberOfChannels * 4 > MAXIMUM_PCM_BYTES) {
		throw new RangeError('The native surround Opus decoder returned different or oversized PCM geometry.');
	}
}

function firstSample(operation: Promise<Sample | null>, signal?: AbortSignal): Promise<Sample | null> {
	if (!signal) return operation;
	return new Promise((resolve, reject) => {
		let retired = false;
		const abort = (): void => { retired = true; signal.removeEventListener('abort', abort); reject(signal.reason); };
		signal.addEventListener('abort', abort, { once: true });
		if (signal.aborted) abort();
		void operation.then(sample => {
			signal.removeEventListener('abort', abort);
			if (retired) { try { sample?.close(); } catch { /* Cancellation already retired this sample. */ } return; }
			resolve(sample);
		}, (error: unknown) => { signal.removeEventListener('abort', abort); if (!retired) reject(error); });
	});
}
