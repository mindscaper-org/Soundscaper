/* SPDX-License-Identifier: AGPL-3.0-only */
import { raceAbortableRead } from '../../../abort-race.ts';
import { inspectOggGaplessGeometry } from '../../../ogg-gapless-import.ts';
import type { NativeContainerAudioAdmission } from './native-container-audio-admission.ts';
import { admitsNativeSurroundVorbisBackend } from '../../../browser-vorbis-decoder.ts';
export { admitsNativeSurroundVorbisBackend } from '../../../browser-vorbis-decoder.ts';

interface Page { readonly packets: number; readonly granule: number; readonly eos: boolean }
const MAXIMUM_ENCODED_BYTES = 32 * 1024 ** 2;
const MAXIMUM_PCM_BYTES = 128 * 1024 ** 2;
const MAXIMUM_HEADER_BYTES = 2 * 1024 ** 2;

/** WebKit advertises surround Vorbis packets but never returns samples or flush completion. */
export async function nativeSurroundVorbisAdmission(file: Blob, signal?: AbortSignal): Promise<NativeContainerAudioAdmission | null> {
	signal?.throwIfAborted();
	if (!admitsNativeSurroundVorbisBackend() || file.size < 58 || file.size > MAXIMUM_ENCODED_BYTES) return null;
	let headers = 0;
	const read = async (start: number, length: number): Promise<Uint8Array<ArrayBuffer>> => {
		signal?.throwIfAborted(); headers += length;
		if (headers > MAXIMUM_HEADER_BYTES) throw new RangeError('The native Vorbis source exceeds its bounded header inventory.');
		const bytes = await raceAbortableRead(() => file.slice(start, start + length).arrayBuffer(), signal);
		signal?.throwIfAborted(); return new Uint8Array(bytes);
	};
	const first = await read(0, 58);
	const initial = new DataView(first.buffer);
	if (first.length !== 58 || ascii(first, 0, 4) !== 'OggS' || first[4] !== 0 || first[5] !== 2
		|| first[26] !== 1 || first[27] !== 30 || first[28] !== 1 || ascii(first, 29, 6) !== 'vorbis'
		|| initial.getUint32(35, true) !== 0) return null;
	const channelCount = first[39]!, sampleRate = initial.getUint32(40, true);
	if (channelCount < 3 || channelCount > 8 || sampleRate < 8_000 || sampleRate > 192_000) return null;
	const serial = initial.getUint32(14, true), pages: Page[] = [];
	let metadataPackets = 3, offset = 0, sequence = 0, continued = false, packetCount = 0;
	while (offset < file.size) {
		const header = await read(offset, 27);
		if (header.length !== 27 || ascii(header, 0, 4) !== 'OggS' || header[4] !== 0 || header[5]! & ~7) return null;
		const view = new DataView(header.buffer), flags = header[5]!;
		if (view.getUint32(14, true) !== serial || view.getUint32(18, true) !== sequence++
			|| Boolean(flags & 1) !== continued || Boolean(flags & 2) !== (offset === 0)) return null;
		const laces = await read(offset + 27, header[26]!);
		if (laces.length !== header[26]) return null;
		const size = 27 + laces.length + laces.reduce((sum, byte) => sum + byte, 0);
		if (size > file.size - offset) return null;
		continued = laces.at(-1) === 255;
		const completed = laces.filter(byte => byte < 255).length;
		const granule = Number(view.getBigInt64(6, true));
		if (!Number.isSafeInteger(granule)) return null;
		if (metadataPackets > 0) {
			if (completed > metadataPackets || granule !== 0 || flags & 4) return null;
			metadataPackets -= completed;
		} else {
			if (++packetCount > 65_536 || completed === 0 && granule !== -1 || completed > 0 && granule < 0) return null;
			pages.push({ packets: completed, granule, eos: Boolean(flags & 4) });
		}
		offset += size;
		if (flags & 4 && (offset !== file.size || continued)) return null;
		if (sequence % 64 === 0) await new Promise<void>(resolve => setTimeout(resolve, 0));
	}
	// A nonfinal audio page proves a zero PCM origin, avoiding ambiguous single-page trims.
	if (metadataPackets || pages.length < 2 || !pages.at(-1)?.eos) return null;
	const { Input, BlobSource, OGG, EncodedPacketSink } = await import('mediabunny');
	signal?.throwIfAborted();
	const input = new Input({ source: new BlobSource(file, { maxCacheSize: 4 * 1024 ** 2, useStreamReader: false }), formats: [OGG] });
	const retire = (): void => input.dispose(); signal?.addEventListener('abort', retire, { once: true });
	try {
		const tracks = await raceAbortableRead(() => input.getAudioTracks(), signal); signal?.throwIfAborted();
		const track = tracks[0];
		if (tracks.length !== 1 || !track || await track.getCodec() !== 'vorbis'
			|| await track.getSampleRate() !== sampleRate || await track.getNumberOfChannels() !== channelCount) return null;
		const iterator = new EncodedPacketSink(track).packets(undefined, undefined, { metadataOnly: true })[Symbol.asyncIterator]();
		let frames = 0, packets = 0, lastFrames = 0, witnessedOrigin = false;
		for (const page of pages) {
			for (let index = 0; index < page.packets; index++) {
				signal?.throwIfAborted(); const next = await raceAbortableRead(() => iterator.next(), signal); signal?.throwIfAborted();
				if (next.done || ++packets > 65_536) return null;
				const packet = next.value, count = Math.round(packet.duration * sampleRate);
				if (packet.byteLength < 1 || packet.byteLength > 1024 ** 2 || count < 0 || count > 8192
					|| packets > 1 && count === 0 || Math.abs(packet.duration * sampleRate - count) > 1e-5) return null;
				lastFrames = count; frames += count;
				if ((frames + 1) * channelCount * 4 > MAXIMUM_PCM_BYTES) return null;
			}
			if (page.packets === 0) continue;
			if (page.eos) {
				if (page.granule <= 0 || page.granule > frames || page.granule <= frames - lastFrames) return null;
			} else {
				if (page.granule !== frames) return null;
				witnessedOrigin = true;
			}
		}
		if (!witnessedOrigin || !(await raceAbortableRead(() => iterator.next(), signal)).done) return null;
		const geometry = await raceAbortableRead(() => inspectOggGaplessGeometry(file, 'vorbis', signal), signal);
		signal?.throwIfAborted();
		if (!geometry || geometry.sampleRate !== sampleRate || geometry.sourceFrames !== pages.at(-1)?.granule) return null;
		return Object.freeze({ sampleRate, channelCount, frameCount: geometry.sourceFrames,
			decodeSampleRate: sampleRate, trimNativeVorbisFinalFrame: true });
	} finally { signal?.removeEventListener('abort', retire); input.dispose(); }
}

function ascii(bytes: Uint8Array, start: number, length: number): string {
	return String.fromCharCode(...bytes.subarray(start, start + length));
}
