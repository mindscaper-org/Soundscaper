/* SPDX-License-Identifier: AGPL-3.0-only */
import { SaxesParser } from 'saxes';
import { AEP_LIMITS, type AepChunk } from './aep-container.ts';
interface Element { name: string; attributes: Readonly<Record<string, string>>; text: string; children: AepChunk[] }
const encoder = new TextEncoder();
/** XML is data only: no DTD, entity resolver, stylesheet or external resource access. */
export function parseAepxContainer(bytes: Uint8Array, signal?: AbortSignal): readonly AepChunk[] {
	if (bytes.length > AEP_LIMITS.bytes) throw new RangeError('AEPX source byte budget exceeded.');
	const source = new TextDecoder('utf-8', { fatal: true }).decode(bytes), stack: Element[] = [];
	const parser = new SaxesParser({ xmlns: true }); let elements = 0, decoded = 0, result: readonly AepChunk[] | null = null;
	const allocate = (data: Uint8Array) => { decoded += data.length; if (decoded > AEP_LIMITS.bytes) throw new RangeError('AEPX decoded byte budget exceeded.'); return data; };
	parser.on('doctype', () => { throw new TypeError('AEPX DOCTYPE/DTD declarations are forbidden.'); });
	parser.on('opentag', tag => {
		signal?.throwIfAborted();
		if (++elements > AEP_LIMITS.chunks || stack.length > AEP_LIMITS.depth) throw new RangeError('AEPX element/depth budget exceeded.');
		if (!stack.length && (tag.local !== 'AfterEffectsProject' || result !== null)) throw new TypeError('AEPX requires one AfterEffectsProject root.');
		if (!stack.length && (tag.attributes.majorVersion?.value !== '1' || tag.attributes.minorVersion?.value !== '0')) throw new TypeError('AEPX container version is unsupported.');
		if (tag.uri && tag.uri !== 'http://www.adobe.com/products/aftereffects') throw new TypeError('AEPX namespace is unsupported.');
		stack.push({ name: tag.local, attributes: Object.fromEntries(Object.entries(tag.attributes).map(([key, value]) => [key, value.value])), text: '', children: [] });
	});
	const text = (value: string) => {
		const current = stack.at(-1); if (current) { current.text += value; if (current.text.length > AEP_LIMITS.bytes) throw new RangeError('AEPX text budget exceeded.'); }
	};
	parser.on('text', text); parser.on('cdata', text);
	parser.on('closetag', () => {
		const node = stack.pop()!;
		if (node.name === 'AfterEffectsProject') { result = Object.freeze(node.children); return; }
		if (node.name === 'ProjectXMPMetadata') return;
		let id = node.name.padEnd(4, ' '), type: string | null = null, children: readonly AepChunk[] | null = node.children, data = new Uint8Array();
		if (node.attributes.bdata !== undefined) {
			const hex = node.attributes.bdata;
			if (hex.length % 2 || !/^[a-fA-F0-9]*$/u.test(hex) || node.children.length || node.text.trim()) throw new TypeError('AEPX hex data is invalid or mixed with content.');
			data = new Uint8Array(hex.length / 2); for (let index = 0; index < data.length; index++) data[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
			children = null; if (node.name === 'btdk') { id = 'LIST'; type = 'btdk'; }
		} else if (node.name === 'string') { id = 'Utf8'; data = encoder.encode(node.text); children = null; }
		else if (node.name === 'fileReference') { id = 'alas'; data = encoder.encode(JSON.stringify(node.attributes)); children = null; }
		else if (node.name === 'numS' || node.name === 'ppSn') {
			if (node.children.length !== 1 || node.children[0]?.id !== 'Utf8') throw new TypeError('AEPX numeric string is invalid.');
			const value = Number(new TextDecoder().decode(node.children[0].data));
			if (!Number.isFinite(value)) throw new TypeError('AEPX number is not finite.');
			data = new Uint8Array(node.name === 'numS' ? 4 : 8); const view = new DataView(data.buffer);
			if (node.name === 'numS') { if (!Number.isInteger(value) || value < -2147483648 || value > 0xffffffff) throw new RangeError('AEPX integer is out of range.'); view.setUint32(0, value); } else view.setFloat64(0, value);
			children = null;
		} else if (/^[\x20-\x7e]{1,4}$/u.test(node.name)) {
			if (!['tdsn', 'pdnm', 'fnam'].includes(node.name)) { type = id; id = 'LIST'; }
			if (node.text.trim()) throw new TypeError('AEPX list has unexpected text.');
		} else return;
		stack.at(-1)?.children.push(Object.freeze({ id, type, children, data: allocate(data) }));
	});
	for (let offset = 0; offset < source.length; offset += 64 * 1024) { signal?.throwIfAborted(); parser.write(source.slice(offset, offset + 64 * 1024)); }
	parser.close(); if (result === null) throw new TypeError('AEPX has no project root.'); return result;
}
