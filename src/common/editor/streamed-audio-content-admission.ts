/* SPDX-License-Identifier: AGPL-3.0-only */
import { raceAbortableRead } from '../foundation/abort-race.ts';
import { isStreamedAudioImportFile } from './streamed-audio-import-file.ts';
import { hasNativeOggSpeexIdentity } from './ogg-speex-source-identity.ts';

const OTHER_MEDIA_SUFFIX = /\.(?:wav|wave|rf64|bw64|bwf|aif|aiff|aifc|au|snd|caf|mka|webm|mov|m4v|wma)$/iu;
const MPEG1_BITRATES = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];
const MPEG2_BITRATES = [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];
interface Frame { readonly byteLength: number; readonly sampleRate: number; readonly version: number; readonly channels: number }

/** Generic downloads retain the same qualified decoder ownership as named recordings. */
export async function inspectStreamedAudioImportFile(value: unknown, signal?: AbortSignal): Promise<boolean> {
	signal?.throwIfAborted();
	if (isStreamedAudioImportFile(value)) {
		const name = 'name' in value ? String(value.name) : '', type = value.type.split(';', 1)[0]!.trim();
		const ogg = /\.(?:ogg|oga|opus|spx)$/iu.test(name) || /^(?:audio\/(?:ogg|opus)|application\/(?:x-)?ogg)$/iu.test(type);
		return !ogg || !(await hasNativeOggSpeexIdentity(value, signal));
	}
	if (!(value instanceof Blob)) return false;
	const file = value;
	const name = 'name' in file ? String(file.name) : '', type = file.type.split(';', 1)[0]!.trim().toLowerCase();
	if (OTHER_MEDIA_SUFFIX.test(name) || type !== '' && type !== 'application/octet-stream') return false;
	const signature = await read(file, 0, 8, signal);
	if (signature.length === 8 && String.fromCharCode(...signature.subarray(4)) === 'ftyp') {
		const { hasOpaqueIsoAacIdentity } = await raceAbortableRead(() => import('./opaque-iso-audio-import-identity.ts'), signal);
		signal?.throwIfAborted(); return hasOpaqueIsoAacIdentity(file, signal);
	}
	let offset = 0;
	for (let tags = 0; tags < 4096; tags++) {
		const header = await read(file, offset, 10, signal);
		if (header.length < 3 || header[0] !== 73 || header[1] !== 68 || header[2] !== 51) {
			const first = frame(header), second = first ? frame(await read(file, offset + first.byteLength, 4, signal)) : null;
			return Boolean(first && second && first.sampleRate === second.sampleRate && first.version === second.version
				&& first.channels === second.channels && offset + first.byteLength + second.byteLength <= file.size);
		}
		const major = header[3]!, flags = header[5]!, allowedFlags = major === 2 ? 0xc0 : major === 3 ? 0xe0 : 0xf0;
		if (header.length !== 10 || major < 2 || major > 4 || header[4] === 255 || flags & ~allowedFlags
			|| header.subarray(6).some(byte => byte > 127)) return false;
		const size = header.subarray(6).reduce((value, byte) => value * 128 + byte, 0);
		const next = offset + 10 + size;
		if (!Number.isSafeInteger(next) || next > file.size) return false;
		if (major === 4 && flags & 16) {
			const footer = await read(file, next, 10, signal);
			if (footer.length !== 10 || footer[0] !== 51 || footer[1] !== 68 || footer[2] !== 73
				|| footer.subarray(3).some((byte, index) => byte !== header[index + 3])) return false;
			offset = next + 10;
		} else offset = next;
		if (tags % 64 === 63) { await new Promise<void>(resolve => setTimeout(resolve, 0)); signal?.throwIfAborted(); }
	}
	return false;
}

function frame(bytes: Uint8Array): Frame | null {
	if (bytes.length < 4 || bytes[0] !== 255 || (bytes[1]! & 224) !== 224 || (bytes[1]! >> 1 & 3) !== 1) return null;
	const version = bytes[1]! >> 3 & 3, rateIndex = bytes[2]! >> 2 & 3, bitrateIndex = bytes[2]! >> 4;
	if (version === 1 || rateIndex === 3 || bitrateIndex === 0 || bitrateIndex === 15 || (bytes[3]! & 3) === 2) return null;
	const sampleRate = [44_100, 48_000, 32_000][rateIndex]! / (version === 3 ? 1 : version === 2 ? 2 : 4);
	const bitrate = (version === 3 ? MPEG1_BITRATES : MPEG2_BITRATES)[bitrateIndex]! * 1000;
	const byteLength = Math.floor((version === 3 ? 144 : 72) * bitrate / sampleRate) + (bytes[2]! >> 1 & 1);
	return { byteLength, sampleRate, version, channels: bytes[3]! >> 6 === 3 ? 1 : 2 };
}
async function read(file: Blob, start: number, count: number, signal?: AbortSignal): Promise<Uint8Array<ArrayBuffer>> {
	signal?.throwIfAborted();
	if (start < 0 || start > file.size) return new Uint8Array();
	const bytes = await raceAbortableRead(() => file.slice(start, Math.min(file.size, start + count)).arrayBuffer(), signal);
	signal?.throwIfAborted(); return new Uint8Array(bytes);
}
