/* SPDX-License-Identifier: AGPL-3.0-only */
/** Native RIFX/Egg! admission. Original bytes, including unknown payloads and XMP, remain separate custody. */
export const AEP_LIMITS = Object.freeze({ bytes: 64 * 1024 * 1024, chunks: 250_000, depth: 48, items: 8192, layers: 4096, keys: 262_144 });
export interface AepChunk {
	readonly id: string; readonly type: string | null; readonly data: Uint8Array; readonly children: readonly AepChunk[] | null;
}
const CRITICAL_LISTS = new Set(['Fold', 'Sfdr', 'Item', 'Layr', 'tdgp', 'tdbs', 'list', 'Pin ']);
const NESTED = new Set(['tdsn', 'pdnm', 'fnam']);
export function aepFourCC(bytes: Uint8Array, offset = 0): string {
	if (offset < 0 || offset + 4 > bytes.length) throw new RangeError('AEP chunk header is truncated.');
	return String.fromCharCode(bytes[offset]!, bytes[offset + 1]!, bytes[offset + 2]!, bytes[offset + 3]!);
}
export function aepView(bytes: Uint8Array, minimum: number): DataView {
	if (bytes.length < minimum) throw new RangeError('AEP record is truncated.');
	return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}
export function aepChild(chunk: AepChunk, name: string): AepChunk | undefined {
	const children = chunk.children?.filter(child => (child.type ?? child.id) === name) ?? [];
	// Utf8 records are ordered fields: items may include both a name and a comment.
	if (children.length > 1 && name !== 'Utf8') throw new TypeError(`AEP singleton record ${name} is duplicated.`); return children[0];
}
export function aepText(bytes: Uint8Array): string {
	const end = bytes.indexOf(0), raw = end < 0 ? bytes : bytes.subarray(0, end);
	return new TextDecoder('utf-8', { fatal: true }).decode(raw);
}
export function parseAepContainer(input: Uint8Array, signal?: AbortSignal): readonly AepChunk[] {
	signal?.throwIfAborted();
	if (!(input instanceof Uint8Array) || input.byteLength > AEP_LIMITS.bytes) throw new RangeError('AEP source byte budget exceeded.');
	const bytes = new Uint8Array(input), view = aepView(bytes, 12);
	if (aepFourCC(bytes) !== 'RIFX' || aepFourCC(bytes, 8) !== 'Egg!') throw new TypeError('AEP requires a RIFX/Egg! project container.');
	const declared = view.getUint32(4), end = declared + 8;
	if (declared < 4 || end > bytes.length) throw new RangeError('AEP container length is invalid or truncated.');
	let count = 0, probes = 0;
	function sequenceFits(start: number, finish: number): boolean {
		let cursor = start;
		while (cursor < finish) {
			if (++probes > AEP_LIMITS.chunks * 4) throw new RangeError('AEP chunk inspection budget exceeded.');
			if (finish - cursor < 8) return false;
			const size = view.getUint32(cursor + 4), bodyEnd = cursor + 8 + size;
			if (bodyEnd > finish) return false;
			cursor = bodyEnd + (size % 2 && bodyEnd < finish ? 1 : 0);
		}
		return cursor === finish;
	}
	function sequence(start: number, finish: number, depth: number): readonly AepChunk[] {
		if (depth > AEP_LIMITS.depth) throw new RangeError('AEP nesting depth budget exceeded.');
		const chunks: AepChunk[] = [];
		for (let cursor = start; cursor < finish;) {
			signal?.throwIfAborted();
			if (++count > AEP_LIMITS.chunks) throw new RangeError('AEP chunk count budget exceeded.');
			if (finish - cursor < 8) throw new RangeError('AEP chunk header is truncated.');
			const id = aepFourCC(bytes, cursor), size = view.getUint32(cursor + 4), body = cursor + 8, bodyEnd = body + size;
			if (bodyEnd > finish) throw new RangeError('AEP chunk exceeds its enclosing container.');
			let type: string | null = null, children: readonly AepChunk[] | null = null, offset = body;
			if (id === 'LIST') {
				if (size < 4) throw new RangeError('AEP list type is truncated.');
				type = aepFourCC(bytes, body); offset += 4;
				if (type !== 'btdk') {
					if (sequenceFits(offset, bodyEnd)) children = sequence(offset, bodyEnd, depth + 1);
					else if (CRITICAL_LISTS.has(type)) throw new RangeError('AEP critical list has damaged chunk structure.');
				}
			} else if (NESTED.has(id) && size >= 8 && sequenceFits(body, bodyEnd)) children = sequence(body, bodyEnd, depth + 1);
			chunks.push(Object.freeze({ id, type, data: bytes.subarray(offset, bodyEnd), children }));
			cursor = bodyEnd + (size % 2 && bodyEnd < finish ? 1 : 0);
		}
		return Object.freeze(chunks);
	}
	return sequence(12, end, 0);
}
