/* SPDX-License-Identifier: AGPL-3.0-only */
import { nativeOggFlacAdmission } from './native-ogg-flac-admission.ts';
import { isDesktopMainAudioCodecRuntime } from '../../../desktop-main-audio-codec-runtime-marker.ts';

const MAXIMUM_ENCODED_BYTES = 32 * 1024 ** 2;
const MAXIMUM_PCM_BYTES = 128 * 1024 ** 2;
const MAXIMUM_CHANNELS = 32;
const AAC_SAMPLE_RATES = [96_000, 88_200, 64_000, 48_000, 44_100, 32_000, 24_000, 22_050, 16_000, 12_000, 11_025, 8_000, 7_350];
export interface NativeContainerAudioAdmission {
	readonly sampleRate: number;
	readonly frameCount: number;
	/** ADTS PCE delegates layout to the native decoder, within the admitted worst-case bound. */
	readonly channelCount: number | null;
	readonly decodeSampleRate?: number;
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
