/* SPDX-License-Identifier: AGPL-3.0-only */

import { isRangeBackedAudioExport, registerRangeBackedAudioExport } from './file-backed-audio-export.ts';

const CHUNK_BYTES = 1024 ** 2;

/** Native Blob construction cannot retain the virtual ranges of a desktop scratch Blob. */
export function prependAudioExportBytes(prefix: Uint8Array<ArrayBuffer>, body: Blob): Blob {
	const header = new Blob([prefix]);
	return isRangeBackedAudioExport(body)
		? registerRangeBackedAudioExport(new PrefixedAudioBlob(header, body, 0, header.size + body.size, body.type))
		: new Blob([header, body], { type: body.type });
}

/** Keep chapter metadata in memory and read the encoded audio from its existing owner. */
class PrefixedAudioBlob extends Blob {
	readonly #header: Blob;
	readonly #body: Blob;
	readonly #offset: number;
	readonly #length: number;
	readonly #type: string;
	constructor(header: Blob, body: Blob, offset: number, length: number, type: string) {
		super(); this.#header = header; this.#body = body;
		this.#offset = offset; this.#length = length; this.#type = type;
	}
	override get size(): number { return this.#length; }
	override get type(): string { return this.#type; }
	override slice(start = 0, end = this.size, contentType = ''): Blob {
		const first = this.bound(start), last = this.bound(end);
		return new PrefixedAudioBlob(this.#header, this.#body, this.#offset + first, Math.max(0, last - first), contentType);
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
		const headerEnd = Math.min(end, this.#header.size);
		if (start < headerEnd) bytes.set(new Uint8Array(await this.#header.slice(start, headerEnd).arrayBuffer()));
		const bodyStart = Math.max(start, this.#header.size);
		if (bodyStart < end) bytes.set(new Uint8Array(await this.#body.slice(bodyStart - this.#header.size, end - this.#header.size).arrayBuffer()), bodyStart - start);
		return bytes;
	}
}
