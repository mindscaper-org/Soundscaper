/* SPDX-License-Identifier: AGPL-3.0-only */
import { nativeOggFlacAdmission } from './native-ogg-flac-admission.ts';
import { isDesktopMainAudioCodecRuntime } from '../../../desktop-main-audio-codec-runtime-marker.ts';
import { raceAbortableRead } from '../../../abort-race.ts';
import { canonicalNativeVorbisBuffer } from '../../../browser-vorbis-decoder.ts';
import { inspectWave64PcmSourceGeometry } from '../../../wave64-pcm-source-geometry.ts';
import { inspectNistPcmSourceGeometry } from '../../../nist-pcm-source-geometry.ts';
import { inspectIrcamPcmSourceGeometry } from '../../../ircam-pcm-source-geometry.ts';
import { inspectPafPcmSourceGeometry } from '../../../paf-pcm-source-geometry.ts';
import { inspectIff16svPcmSourceGeometry } from '../../../iff16sv-pcm-source-geometry.ts';
import { inspectWavAdpcmSourceGeometry } from '../../../wav-adpcm-source-geometry.ts';
import { inspectSdsPcmSourceGeometry } from '../../../sds-pcm-source-geometry.ts';

const MAXIMUM_ENCODED_BYTES = 32 * 1024 ** 2;
const MAXIMUM_PCM_BYTES = 128 * 1024 ** 2;
const MAXIMUM_CHANNELS = 32;
const NATIVE_CONTAINER_AUDIO_VIEWS = new WeakSet<object>();
const AAC_SAMPLE_RATES = [96_000, 88_200, 64_000, 48_000, 44_100, 32_000, 24_000, 22_050, 16_000, 12_000, 11_025, 8_000, 7_350];
export interface NativeContainerAudioAdmission {
	readonly sampleRate: number;
	readonly frameCount: number;
	/** ADTS PCE delegates layout to the native decoder, within the admitted worst-case bound. */
	readonly channelCount: number | null;
	readonly decodeSampleRate?: number;
	readonly trimNativeVorbisFinalFrame?: true;
}
interface Options {
	readonly signal?: AbortSignal;
	readonly codecRuntime?: unknown;
	readonly nativeSampleRate: () => number | PromiseLike<number>;
}

/** Native browsers already accept these profiles, which the incremental demuxer cannot select. */
export async function nativeContainerAudioAdmission(file: Blob, options: Options): Promise<NativeContainerAudioAdmission | null> {
	const flac = await nativeOggFlacAdmission(file, options);
	if (flac) return flac;
	options.signal?.throwIfAborted();
	if (isDesktopMainAudioCodecRuntime(options.codecRuntime) || file.size < 9 || file.size > MAXIMUM_ENCODED_BYTES) return null;
	if (new TextDecoder().decode(await raceAbortableRead(() => file.slice(0, 4).arrayBuffer(), options.signal)) === 'OggS') return (await import('./native-surround-vorbis-admission.ts')).nativeSurroundVorbisAdmission(file, options.signal);
	let offset = 0;
	let first = await headerAt(file, offset, options.signal);
	if (ascii(first, 4, 4) === 'ftyp') return (await import('./native-alac-import-admission.ts')).nativeAlacImportAdmission(file, options.signal);
	// Keep ordinary leading ID3 tags outside the AAC packet inventory.
	for (let tags = 0; ascii(first, 0, 3) === 'ID3'; tags++) {
		if (tags >= 16) return null;
		const bytes = new Uint8Array(await file.slice(offset, offset + 10).arrayBuffer());
		options.signal?.throwIfAborted();
		if (bytes.length !== 10 || ![2, 3, 4].includes(bytes[3]!) || bytes.subarray(6).some(byte => byte > 127)) return null;
		const size = bytes[6]! * 0x20_0000 + bytes[7]! * 0x4000 + bytes[8]! * 128 + bytes[9]!;
		offset += size + 10;
		if (bytes[5]! & 16) {
			if (bytes[3] !== 4) return null;
			const footer = new Uint8Array(await file.slice(offset, offset + 10).arrayBuffer());
			options.signal?.throwIfAborted();
			if (ascii(footer, 0, 3) !== '3DI' || footer.length !== 10 || footer.subarray(3).some((byte, index) => byte !== bytes[index + 3])) return null;
			offset += 10;
		}
		if (offset > file.size - 9) return null;
		first = await headerAt(file, offset, options.signal);
	}
	if (first[0] === 255 && (first[1]! & 0xfe) === 0xfe) {
		const helper = await raceAbortableRead(() => import('./native-mpeg-layer-one-admission.ts'), options.signal);
		options.signal?.throwIfAborted();
		return helper.nativeMpegLayerOneAdmission(file, offset, options.signal);
	}
	if (first[0] === 255 && first[1] === 251 && first[2]! >> 4 === 0) {
		return (await import('./native-free-format-mp3-admission.ts')).nativeFreeFormatMp3Admission(file, offset, options.signal);
	}
	const profile = adtsHeader(first);
	if (!profile || profile.configuration !== 0) return null;
	// ADTS may carry implicit SBR. Preserve the existing unpinned native decode;
	// duration is invariant even when its reconstructed rate differs from the core rate.
	const sampleRate = await options.nativeSampleRate();
	options.signal?.throwIfAborted();
	if (!Number.isSafeInteger(sampleRate) || sampleRate < 3000 || sampleRate > 768_000) return null;
	let packets = 0;
	while (offset < file.size) {
		const header = packets === 0 ? profile : adtsHeader(await headerAt(file, offset, options.signal));
		if (!header || header.configuration !== 0 || header.rate !== profile.rate || header.frameLength > file.size - offset) return null;
		packets++;
		const maximumFrames = Math.ceil(packets * 1024 * sampleRate / profile.rate) + 1;
		if (maximumFrames * MAXIMUM_CHANNELS * 4 > MAXIMUM_PCM_BYTES) return null;
		offset += header.frameLength;
		if (packets % 64 === 0) await new Promise<void>(resolve => setTimeout(resolve, 0));
	}
	options.signal?.throwIfAborted();
	return Object.freeze({ sampleRate, frameCount: Math.round(packets * 1024 * sampleRate / profile.rate), channelCount: null });
}

/** Normalize native speaker roles and authored extent before canonical PCM storage. */
export function normalizeNativeContainerAudio(decoded: AudioBuffer, admission: NativeContainerAudioAdmission | null, encoded?: ArrayBuffer): AudioBuffer {
	if (encoded) {
		const bytes = new Uint8Array(encoded), pcm = inspectWave64PcmSourceGeometry(bytes) ?? inspectNistPcmSourceGeometry(bytes) ?? inspectIrcamPcmSourceGeometry(bytes) ?? inspectPafPcmSourceGeometry(bytes) ?? inspectIff16svPcmSourceGeometry(bytes) ?? inspectSdsPcmSourceGeometry(bytes);
		if (pcm) {
			const excess = decoded.length - pcm.frameCount;
			// Qualified native PCM container readers pad their final1024-frame output block.
			if (decoded.sampleRate !== pcm.sampleRate || decoded.numberOfChannels !== pcm.channelCount
				|| !Number.isSafeInteger(excess) || excess < 0 || excess >= 1024) throw new RangeError('The native PCM decoder returned different source geometry.');
			if (excess > 0) {
				for (let channel = 0; channel < pcm.channelCount; channel++) {
					if (decoded.getChannelData(channel).subarray(pcm.frameCount).some(value => value !== 0)) throw new RangeError('The native PCM endpoint is not zero padding.');
				}
				decoded = nativePcmExtentView(decoded, pcm.frameCount);
			}
		}
		const adpcm = inspectWavAdpcmSourceGeometry(bytes);
		if (adpcm) {
			if (decoded.sampleRate !== adpcm.sampleRate || decoded.numberOfChannels !== adpcm.channelCount
				|| decoded.length !== adpcm.frameCount && decoded.length !== adpcm.decodedFrameCount) throw new RangeError('The native ADPCM decoder returned different source geometry.');
			if (decoded.length > adpcm.frameCount) decoded = nativePcmExtentView(decoded, adpcm.frameCount);
		}
		const normalized = canonicalNativeVorbisBuffer(decoded, encoded);
		if (normalized !== decoded) NATIVE_CONTAINER_AUDIO_VIEWS.add(normalized);
		decoded = normalized;
	}
	if (!admission?.trimNativeVorbisFinalFrame || decoded.length !== admission.frameCount + 1
		|| decoded.sampleRate !== admission.sampleRate || decoded.numberOfChannels !== admission.channelCount) return decoded;
	return nativePcmExtentView(decoded, admission.frameCount);
}

function nativePcmExtentView(decoded: AudioBuffer, length: number): AudioBuffer {
	// Storage consumes this zero-copy PCM view; it must never enter the native resident cache.
	const view = Object.freeze({ length, sampleRate: decoded.sampleRate, duration: length / decoded.sampleRate, numberOfChannels: decoded.numberOfChannels,
		getChannelData: (channel: number) => decoded.getChannelData(channel).subarray(0, length),
		copyFromChannel(destination: Float32Array<ArrayBuffer>, channel: number, start = 0) {
			decoded.copyFromChannel(destination.subarray(0, Math.max(0, length - start)), channel, start);
		},
		copyToChannel(source: Float32Array<ArrayBuffer>, channel: number, start = 0) {
			decoded.copyToChannel(source.subarray(0, Math.max(0, length - start)), channel, start);
		},
	});
	NATIVE_CONTAINER_AUDIO_VIEWS.add(view);
	return view;
}

/** Structural PCM views are valid for storage, but cannot back a native BufferSource. */
export function isNativeContainerAudioView(buffer: object): boolean { return NATIVE_CONTAINER_AUDIO_VIEWS.has(buffer); }

/** Verify the native result before canonicalization, PCM writes or command publication. */
export function assertNativeContainerAudioGeometry(decoded: Readonly<{ sampleRate: number; numberOfChannels: number; length: number }>,
	admission: NativeContainerAudioAdmission | null): void {
	if (!admission) return;
	const tolerance = admission.channelCount === null ? 1 : 0;
	if (decoded.sampleRate !== admission.sampleRate || !Number.isSafeInteger(decoded.length) || decoded.length < 1
		|| Math.abs(decoded.length - admission.frameCount) > tolerance
		|| !Number.isSafeInteger(decoded.numberOfChannels) || decoded.numberOfChannels < 1 || decoded.numberOfChannels > MAXIMUM_CHANNELS
		|| admission.channelCount !== null && decoded.numberOfChannels !== admission.channelCount
		|| decoded.length * decoded.numberOfChannels * 4 > MAXIMUM_PCM_BYTES) {
		throw new RangeError('The native container decoder returned different or oversized PCM geometry.');
	}
}

async function headerAt(file: Blob, offset: number, signal?: AbortSignal): Promise<Uint8Array<ArrayBuffer>> {
	signal?.throwIfAborted();
	const bytes = new Uint8Array(await file.slice(offset, Math.min(file.size, offset + 9)).arrayBuffer());
	signal?.throwIfAborted();
	return bytes;
}
function adtsHeader(bytes: Uint8Array): Readonly<{ rate: number; frameLength: number; configuration: number }> | null {
	if (bytes.length < 7 || bytes[0] !== 255 || (bytes[1]! & 0xf6) !== 0xf0 || bytes[2]! >> 6 !== 1 || (bytes[6]! & 3) !== 0) return null;
	const rate = AAC_SAMPLE_RATES[bytes[2]! >> 2 & 15];
	const headerLength = bytes[1]! & 1 ? 7 : 9;
	const frameLength = (bytes[3]! & 3) * 2048 + bytes[4]! * 8 + (bytes[5]! >> 5);
	if (!rate || bytes.length < headerLength || frameLength <= headerLength) return null;
	return { rate, frameLength, configuration: (bytes[2]! & 1) * 4 + (bytes[3]! >> 6) };
}
function ascii(bytes: Uint8Array, offset: number, length: number): string { return String.fromCharCode(...bytes.subarray(offset, offset + length)); }
