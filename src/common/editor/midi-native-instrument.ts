/* SPDX-License-Identifier: AGPL-3.0-only */

/** Portable identity; paths and machine-local installation choices never enter projects. */
export interface MidiNativeInstrument {
	readonly kind: 'native';
	readonly format: 'vst2' | 'vst3' | 'lv2';
	readonly stablePluginId: string;
	readonly binarySha256: string;
	readonly name: string;
	/** Base64 vendor state travels with the existing opaque MIDI carrier. */
	readonly state: string;
}

export function normalizeMidiNativeInstrument(value: unknown): MidiNativeInstrument {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Invalid native instrument.');
	const input = value as Record<string, unknown>;
	if (input.kind !== 'native' || !['vst2', 'vst3', 'lv2'].includes(String(input.format))
		|| typeof input.binarySha256 !== 'string' || !/^[a-f0-9]{64}$/u.test(input.binarySha256)
		|| typeof input.state !== 'string' || input.state.length > 16 * 1024 * 1024
		|| input.state.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/u.test(input.state)) {
		throw new RangeError('Invalid native instrument identity or state.');
	}
	for (const key of ['stablePluginId', 'name']) {
		if (typeof input[key] !== 'string' || !input[key].trim() || input[key].length > 1024) throw new RangeError('Invalid native instrument label.');
	}
	return { kind: 'native', format: input.format as MidiNativeInstrument['format'], stablePluginId: input.stablePluginId as string,
		binarySha256: input.binarySha256, name: input.name as string, state: input.state };
}
