/* SPDX-License-Identifier: AGPL-3.0-only */
/** A small, reproducible reference bank authored here. It contains no third-party samples.
 * Its harmonic voices exercise all GM programs; it is not a sampled acoustic GM library.
 */
export function createMidiReferenceSoundFont(): ArrayBuffer {
	const families = 17, sampleFrames = 100, guard = 46;
	const samples = new Uint8Array(families * (sampleFrames + guard) * 2), sampleView = new DataView(samples.buffer);
	for (let family = 0; family < families; family++) {
		for (let frame = 0; frame < sampleFrames; frame++) {
			let value = 0, level = 0;
			for (let harmonic = 1; harmonic <= 1 + family % 7; harmonic++) {
				const gain = 1 / harmonic ** (1 + family % 3 * 0.5);
				value += Math.sin(2 * Math.PI * frame * harmonic / sampleFrames) * gain; level += gain;
			}
			sampleView.setInt16((family * (sampleFrames + guard) + frame) * 2, Math.round(value / level * 24000), true);
		}
	}
	const phdr = bytes(130 * 38), pbag = bytes(130 * 4), pgen = bytes(129 * 4);
	for (let preset = 0; preset < 129; preset++) {
		textAt(phdr, preset * 38, `Reference ${preset}`);
		u16(phdr, preset * 38 + 20, preset === 128 ? 0 : preset);
		u16(phdr, preset * 38 + 22, preset === 128 ? 128 : 0);
		u16(phdr, preset * 38 + 24, preset); u16(pbag, preset * 4, preset);
		u16(pgen, preset * 4, 41); u16(pgen, preset * 4 + 2, preset === 128 ? 16 : Math.floor(preset / 8));
	}
	textAt(phdr, 129 * 38, 'EOP'); u16(phdr, 129 * 38 + 24, 129); u16(pbag, 129 * 4, 129);
	const inst = bytes((families + 1) * 22), ibag = bytes((families + 1) * 4), igen = bytes(families * 6 * 4);
	const shdr = bytes((families + 1) * 46);
	for (let family = 0; family < families; family++) {
		textAt(inst, family * 22, `Harmonics ${family}`); u16(inst, family * 22 + 20, family);
		u16(ibag, family * 4, family * 6);
		const generators = [[34, -9600], [36, -1200], [37, 120], [38, -2400], [54, 1], [53, family]];
		for (const [index, [operator, amount]] of generators.entries()) { u16(igen, (family * 6 + index) * 4, operator!); u16(igen, (family * 6 + index) * 4 + 2, amount! & 65535); }
		const offset = family * 46, start = family * (sampleFrames + guard);
		textAt(shdr, offset, `Wave ${family}`);
		for (const [field, value] of [[20, start], [24, start + sampleFrames], [28, start], [32, start + sampleFrames], [36, 44000]]) u32(shdr, offset + field!, value!);
		shdr[offset + 40] = 69; u16(shdr, offset + 44, 1);
	}
	textAt(inst, families * 22, 'EOI'); u16(inst, families * 22 + 20, families); u16(ibag, families * 4, families * 6);
	textAt(shdr, families * 46, 'EOS');
	return chunk('RIFF', concat(encode('sfbk'),
		list('INFO', chunk('ifil', new Uint8Array([2, 0, 1, 0])), chunk('INAM', encode('Soundscaper reference bank\0\0'))),
		list('sdta', chunk('smpl', samples)), list('pdta', chunk('phdr', phdr), chunk('pbag', pbag), chunk('pmod', bytes(10)), chunk('pgen', pgen),
			chunk('inst', inst), chunk('ibag', ibag), chunk('imod', bytes(10)), chunk('igen', igen), chunk('shdr', shdr)))).buffer;
}
function bytes(size: number): Uint8Array<ArrayBuffer> { return new Uint8Array(size); }
function encode(value: string): Uint8Array<ArrayBuffer> { return new TextEncoder().encode(value); }
function textAt(buffer: Uint8Array, offset: number, value: string): void { buffer.set(encode(value).subarray(0, 19), offset); }
function u16(buffer: Uint8Array, offset: number, value: number): void { new DataView(buffer.buffer).setUint16(offset, value, true); }
function u32(buffer: Uint8Array, offset: number, value: number): void { new DataView(buffer.buffer).setUint32(offset, value, true); }
function concat(...parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
	const result = bytes(parts.reduce((sum, part) => sum + part.length, 0)); let offset = 0;
	for (const part of parts) { result.set(part, offset); offset += part.length; } return result;
}
function chunk(id: string, value: Uint8Array): Uint8Array<ArrayBuffer> {
	const header = bytes(8); header.set(encode(id)); u32(header, 4, value.length);
	return concat(header, value, bytes(value.length % 2));
}
function list(id: string, ...parts: Uint8Array[]): Uint8Array<ArrayBuffer> { return chunk('LIST', concat(encode(id), ...parts)); }
