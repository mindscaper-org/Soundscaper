/* SPDX-License-Identifier: AGPL-3.0-only */
export interface NistPcmSourceGeometry {
	readonly sampleRate: number;
	readonly channelCount: number;
	readonly frameCount: number;
}

/** NIST_1A PCM16 mono/stereo with a complete typed ASCII header and exact sample extent. */
export function inspectNistPcmSourceGeometry(bytes: Uint8Array): NistPcmSourceGeometry | null {
	if (bytes.length < 1026 || ![...('NIST_1A\n')].every((value, index) => bytes[index] === value.charCodeAt(0))) return null;
	const sizeLine = new TextDecoder().decode(bytes.subarray(8, 16));
	if (!/^ *[1-9][0-9]*\n$/u.test(sizeLine)) return null;
	const headerSize = Number(sizeLine.trim());
	if (headerSize < 1024 || headerSize > 65_536 || headerSize % 1024 !== 0 || headerSize > bytes.length - 2) return null;
	const header = new TextDecoder().decode(bytes.subarray(16, headerSize)), end = header.indexOf('\nend_head\n');
	if (end < 0) return null;
	const text = header.slice(0, end);
	if ([...text].some(character => character.charCodeAt(0) > 127)) return null;
	const lines = text.split('\n');
	if (lines.length > 256) return null;
	const fields = new Map<string, Readonly<{ type: string; value: string }>>();
	for (const line of lines) {
		const match = /^([A-Za-z_][A-Za-z0-9_]{0,63}) -(i|r|s([0-9]{1,5})) (.*)$/u.exec(line);
		if (!match || fields.has(match[1]!)) return null;
		const type = match[2]!, value = match[4]!;
		if (type.startsWith('s') ? value.length !== Number(match[3]) : type === 'i'
			? !/^[+-]?[0-9]{1,16}$/u.test(value) : !Number.isFinite(Number(value)) || value.trim() === '') return null;
		fields.set(match[1]!, { type, value });
	}
	const integer = (name: string): number | null => {
		const field = fields.get(name);
		return field?.type === 'i' && Number.isSafeInteger(Number(field.value)) ? Number(field.value) : null;
	};
	const coding = fields.get('sample_coding'), order = fields.get('sample_byte_format');
	const sampleRate = integer('sample_rate'), channelCount = integer('channel_count'), frameCount = integer('sample_count');
	if (sampleRate === null || sampleRate < 3000 || sampleRate > 384_000 || channelCount === null || ![1, 2].includes(channelCount)
		|| frameCount === null || frameCount < 1 || integer('sample_n_bytes') !== 2
		|| fields.has('sample_sig_bits') && integer('sample_sig_bits') !== 16 || coding?.type !== 's3' || coding.value !== 'pcm'
		|| order?.type !== 's2' || !['01', '10'].includes(order.value)) return null;
	const dataBytes = frameCount * channelCount * 2;
	if (!Number.isSafeInteger(dataBytes) || dataBytes !== bytes.length - headerSize) return null;
	return Object.freeze({ sampleRate, channelCount, frameCount });
}
