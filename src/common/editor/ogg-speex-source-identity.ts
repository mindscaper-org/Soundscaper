/* SPDX-License-Identifier: AGPL-3.0-only */
import { raceAbortableRead } from '../foundation/abort-race.ts';
import { oggPageCrc } from './ogg-page-crc.ts';

const MAXIMUM_ENCODED_BYTES = 32 * 1024 ** 2;
const MAXIMUM_PCM_BYTES = 128 * 1024 ** 2;
interface Profile { readonly sampleRate: number; readonly frameSize: number; readonly framesPerPacket: number; readonly serial: number }

/** Own only a complete, single-stream, ordinary mono Speex mapping. No PCM is decoded here. */
export function inspectOggSpeexSampleRate(bytes: Uint8Array): number | null {
	if (bytes.length > MAXIMUM_ENCODED_BYTES) return null;
	const inventory = SpeexInventory.create(bytes.subarray(0, 108));
	if (!inventory) return null;
	let offset = 0;
	while (offset < bytes.length) {
		const size = pageSize(bytes.subarray(offset));
		if (size === null || size > bytes.length - offset || !inventory.accept(bytes.subarray(offset, offset + size))) return null;
		offset += size;
	}
	return inventory.complete ? inventory.sampleRate : null;
}

/** The incremental demuxer has no Speex decoder; preserve the existing native whole-file route. */
export async function hasNativeOggSpeexIdentity(file: Blob, signal?: AbortSignal): Promise<boolean> {
	signal?.throwIfAborted();
	if (file.size < 108 || file.size > MAXIMUM_ENCODED_BYTES) return false;
	const read = async (start: number, length: number): Promise<Uint8Array<ArrayBuffer>> => {
		const bytes = await raceAbortableRead(() => file.slice(start, start + length).arrayBuffer(), signal);
		signal?.throwIfAborted(); return new Uint8Array(bytes);
	};
	const first = await read(0, 108), inventory = SpeexInventory.create(first);
	if (!inventory) return false;
	let offset = 0, pages = 0;
	while (offset < file.size) {
		const header = offset === 0 ? first.subarray(0, 27) : await read(offset, 27);
		if (header.length !== 27) return false;
		const laces = offset === 0 ? first.subarray(27, 28) : await read(offset + 27, header[26]!);
		const size = 27 + laces.length + laces.reduce((sum, byte) => sum + byte, 0);
		if (laces.length !== header[26] || size > file.size - offset) return false;
		if (!inventory.accept(offset === 0 ? first : await read(offset, size))) return false;
		offset += size;
		if (++pages % 64 === 0) { await new Promise<void>(resolve => setTimeout(resolve, 0)); signal?.throwIfAborted(); }
	}
	return inventory.complete;
}

class SpeexInventory {
	readonly sampleRate: number;
	readonly #profile: Profile;
	#sequence = 0;
	#continued = false;
	#metadata = 2;
	#packets = 0;
	#headers = 0;
	#granule = 0;
	#eos = false;
	private constructor(profile: Profile) { this.#profile = profile; this.sampleRate = profile.sampleRate; }
	static create(page: Uint8Array): SpeexInventory | null {
		if (page.length !== 108 || page[5] !== 2 || page[26] !== 1 || page[27] !== 80
			|| ascii(page, 28, 8) !== 'Speex   ') return null;
		const view = new DataView(page.buffer, page.byteOffset, page.byteLength), start = 28;
		const sampleRate = view.getUint32(start + 36, true), mode = view.getUint32(start + 40, true);
		const frameSize = view.getUint32(start + 56, true), framesPerPacket = view.getUint32(start + 64, true);
		if (view.getUint32(start + 28, true) !== 1 || view.getUint32(start + 32, true) !== 80 || mode > 2
			|| sampleRate !== [8000, 16000, 32000][mode] || frameSize !== sampleRate / 50
			|| view.getUint32(start + 44, true) !== 4 || view.getUint32(start + 48, true) !== 1
			|| view.getUint32(start + 60, true) > 1 || framesPerPacket < 1 || framesPerPacket > 10
			|| view.getUint32(start + 68, true) !== 0 || view.getUint32(start + 72, true) !== 0 || view.getUint32(start + 76, true) !== 0) return null;
		return new SpeexInventory({ sampleRate, frameSize, framesPerPacket, serial: view.getUint32(14, true) });
	}
	accept(page: Uint8Array): boolean {
		if (this.#eos || this.#sequence >= 65_536 || page.length < 28 || ascii(page, 0, 4) !== 'OggS'
			|| page[4] !== 0 || !page[26] || page[5]! & ~7 || pageSize(page) !== page.length) return false;
		const view = new DataView(page.buffer, page.byteOffset, page.byteLength), flags = page[5]!;
		if (view.getUint32(14, true) !== this.#profile.serial || view.getUint32(18, true) !== this.#sequence
			|| Boolean(flags & 1) !== this.#continued || Boolean(flags & 2) !== (this.#sequence === 0)
			|| view.getUint32(22, true) !== oggPageCrc(page)) return false;
		this.#headers += 27 + page[26]!; if (this.#headers > 2 * 1024 ** 2) return false;
		const laces = page.subarray(27, 27 + page[26]!), completed = laces.filter(byte => byte < 255).length;
		this.#continued = laces.at(-1) === 255;
		const granule = Number(view.getBigInt64(6, true));
		if (!Number.isSafeInteger(granule)) return false;
		if (this.#metadata > 0) {
			if (completed !== 1 || this.#continued || granule !== 0 || flags & 4) return false;
			if (this.#metadata === 1 && !completeComment(page.subarray(27 + laces.length))) return false;
			this.#metadata--;
		} else {
			this.#packets += completed;
			const decodedFrames = this.#packets * this.#profile.frameSize * this.#profile.framesPerPacket;
			if (decodedFrames * 4 > MAXIMUM_PCM_BYTES || completed === 0 && granule !== -1
				|| completed > 0 && (granule < this.#granule || granule > decodedFrames)) return false;
			if (completed > 0) this.#granule = granule;
		}
		this.#eos = Boolean(flags & 4); this.#sequence++;
		return !this.#eos || !this.#continued && this.#granule > 0;
	}
	get complete(): boolean { return this.#eos && this.#metadata === 0 && this.#packets > 0; }
}

function pageSize(bytes: Uint8Array): number | null {
	if (bytes.length < 27 || bytes.length < 27 + bytes[26]!) return null;
	return 27 + bytes[26]! + bytes.subarray(27, 27 + bytes[26]!).reduce((sum, byte) => sum + byte, 0);
}
function ascii(bytes: Uint8Array, offset: number, length: number): string { return String.fromCharCode(...bytes.subarray(offset, offset + length)); }
function completeComment(bytes: Uint8Array): boolean {
	if (bytes.length < 8) return false;
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	let offset = 4 + view.getUint32(0, true);
	if (offset > bytes.length - 4) return false;
	const comments = view.getUint32(offset, true); offset += 4;
	if (comments > 1024) return false;
	for (let index = 0; index < comments; index++) {
		if (offset > bytes.length - 4) return false;
		offset += 4 + view.getUint32(offset, true); if (offset > bytes.length) return false;
	}
	return offset === bytes.length;
}
