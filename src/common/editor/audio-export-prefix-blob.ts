/* SPDX-License-Identifier: AGPL-3.0-only */

import { isRangeBackedAudioExport, registerRangeBackedAudioExport } from './file-backed-audio-export.ts';

const CHUNK_BYTES = 1024 ** 2;

/** Native Blob construction cannot retain the virtual ranges of a desktop scratch Blob. */
export function prependAudioExportBytes(prefix: Uint8Array<ArrayBuffer>, body: Blob): Blob {
	return assembleAudioExportBlob(body, [new Blob([prefix]), body]);
}

/** Keep rewritten metadata in memory and read native audio from its existing owner. */
export function assembleAudioExportBlob(source: Blob, parts: readonly Blob[], type = source.type): Blob {
	if (!isRangeBackedAudioExport(source)) return new Blob([...parts], { type });
	let length = 0;
	const ranges = parts.filter(part => part.size > 0).map(part => {
		const start = length;
		length += part.size;
		return { start, end: length, part };
	});
	return registerRangeBackedAudioExport(new ComposedAudioBlob(ranges, 0, length, type));
}

interface PartRange { readonly start: number; readonly end: number; readonly part: Blob }

class ComposedAudioBlob extends Blob {
	readonly #parts: readonly PartRange[];
	readonly #offset: number;
	readonly #length: number;
	readonly #type: string;
	constructor(parts: readonly PartRange[], offset: number, length: number, type: string) {
		super(); this.#parts = parts;
		this.#offset = offset; this.#length = length; this.#type = type;
	}
	override get size(): number { return this.#length; }
	override get type(): string { return this.#type; }
	override slice(start = 0, end = this.size, contentType = ''): Blob {
		const first = this.bound(start), last = this.bound(end);
		return registerRangeBackedAudioExport(new ComposedAudioBlob(this.#parts, this.#offset + first, Math.max(0, last - first), contentType));
	}
	override async arrayBuffer(): Promise<ArrayBuffer> {
		if (this.size > CHUNK_BYTES) throw new RangeError('Desktop encoded audio requires bounded 1 MiB reads.');
		return (await this.read(0, this.size)).buffer;
	}
	override async bytes(): Promise<Uint8Array<ArrayBuffer>> { return new Uint8Array(await this.arrayBuffer()); }
	override async text(): Promise<string> { return new TextDecoder().decode(await this.arrayBuffer()); }
	override stream(): ReadableStream<Uint8Array<ArrayBuffer>> {
		let offset = 0;
		return new ReadableStream({ pull: async controller => {
			if (offset >= this.size) { controller.close(); return; }
			const length = Math.min(CHUNK_BYTES, this.size - offset);
			controller.enqueue(await this.read(offset, length)); offset += length;
		} });
	}
	private bound(value: number): number {
		const integer = Math.trunc(value) || 0;
		return Math.min(this.size, Math.max(0, integer < 0 ? this.size + integer : integer));
	}
	private async read(offset: number, length: number): Promise<Uint8Array<ArrayBuffer>> {
		const start = this.#offset + offset, end = start + length;
		const bytes = new Uint8Array(length);
		for (const range of this.#parts) {
			if (range.start >= end) break;
			const first = Math.max(start, range.start);
			const last = Math.min(end, range.end);
			if (first >= last) continue;
			const data = await range.part.slice(first - range.start, last - range.start).arrayBuffer();
			bytes.set(new Uint8Array(data), first - start);
		}
		return bytes;
	}
}
