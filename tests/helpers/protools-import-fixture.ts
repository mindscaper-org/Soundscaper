/* SPDX-License-Identifier: AGPL-3.0-only */

/** Independently authored Pro Tools block-layout fixture, with no Avid audio or code. */
export interface ProToolsFixtureOptions {
	readonly version?: number;
	readonly bigEndian?: boolean;
	readonly seed?: number;
	readonly sourceIndex?: number;
	readonly regionIndex?: number;
	readonly start?: number;
	readonly fadeRender?: boolean;
	readonly filename?: string;
	readonly pagePadding?: boolean;
}

export function proToolsFixture(options: ProToolsFixtureOptions = {}): Uint8Array<ArrayBuffer> {
	const version = options.version ?? 12, bigEndian = options.bigEndian ?? version === 5;
	const integer = (value: number, width: number, big = bigEndian): Uint8Array => {
		const bytes = new Uint8Array(width);
		for (let index = 0; index < width; index++) { bytes[big ? width - index - 1 : index] = value % 256; value = Math.floor(value / 256); }
		return bytes;
	};
	const text = (value: string): Uint8Array => { const bytes = new TextEncoder().encode(value); return join(integer(bytes.length, 4), bytes); };
	const block = (kind: number, ...data: readonly Uint8Array[]): Uint8Array => {
		const content = join(integer(kind, 2), ...data);
		return join(Uint8Array.of(0x5a), integer(1, 2), integer(content.length, 4), content);
	};
	const audio = block(0x1004, integer(1, 4), block(0x103a, new Uint8Array(9), text(options.filename ?? 'voice.wav'),
		new TextEncoder().encode('WAVE'), new Uint8Array(version < 8 ? 0 : 5)), block(0x1003, block(0x1001, new Uint8Array(6), integer(48000, 8))));
	const widths = bigEndian ? Uint8Array.of(0, 0, 0x30, 0x30, 0x30) : Uint8Array.of(0, 0x30, 0x30, 0x30, 0);
	const region = block(version >= 10 ? 0x262a : 0x100b, integer(1, 4), block(version >= 10 ? 0x2629 : 0x1008,
		block(version >= 10 ? 0x2628 : 0x1007, text('Phrase'), widths,
			integer(12000, 3, false), integer(24000, 3, false), integer(version < 8 ? options.start ?? 24000 : 96000, 3, false)),
		integer(options.sourceIndex ?? 0, 4)));
	const catalog = block(0x1015, integer(1, 4), block(0x1014, text('Dialogue'), new Uint8Array(1), integer(1, 4), integer(0, 2)));
	const placements = version < 8
		? block(0x1012, integer(1, 4), block(0x1011, text('Dialogue'), block(0x100f, block(0x100e, new Uint8Array(2), integer(options.regionIndex ?? 0, 4)))))
		: block(0x1054, integer(1, 4), block(0x1052, text('Dialogue'), block(0x1050,
			block(0x104f, new Uint8Array(2), integer(options.regionIndex ?? 0, 4), new Uint8Array(1), integer(options.start ?? 24000, 5), new Uint8Array(23)),
			Uint8Array.of(options.fadeRender ? 1 : 0, 0))));
	const header = new Uint8Array(options.pagePadding ? 0x1050 : 0x50);
	header[0] = 3; header.set(new TextEncoder().encode('0010111100101011'), 1);
	header[0x11] = bigEndian ? 1 : 0; header[0x12] = version >= 10 ? 5 : 1; header[0x13] = options.seed ?? 0xa5;
	header[0x40] = version;
	const plain = join(header, block(0x1028, new Uint8Array(2), integer(48000, 4)), audio, region, catalog, placements, new Uint8Array(4200));
	let delta = 0;
	for (let candidate = 0; candidate < 256; candidate++) if ((candidate * (version >= 10 ? 11 : 53) & 255) === header[0x13]) {
		delta = version >= 10 ? -candidate : candidate; break;
	}
	for (let index = 0x14; index < plain.length; index++) plain[index] = plain[index]! ^ ((version >= 10 ? index >>> 12 : index) * delta & 255);
	return plain;
}

function join(...parts: readonly Uint8Array[]): Uint8Array<ArrayBuffer> {
	const result = new Uint8Array(parts.reduce((length, part) => length + part.length, 0));
	let offset = 0;
	for (const part of parts) { result.set(part, offset); offset += part.length; }
	return result;
}
