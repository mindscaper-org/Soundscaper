/* SPDX-License-Identifier: AGPL-3.0-only */

export interface MacroAudioInput {
	readonly name: string;
	readonly sampleRate: number;
	readonly channels: readonly Float32Array[];
}

export type MacroAudioInputResolver = (key: string, sampleRate: number, signal: AbortSignal) => Promise<MacroAudioInput>;

export function macroAudioInputKey(value: unknown): string {
	if (typeof value !== 'string' || !/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/u.test(value)) throw new TypeError('An audio input needs a short named key.');
	return value;
}

/** Selected audio remains host-owned; programs receive only bounded metadata. */
export function admitMacroAudioInput(value: MacroAudioInput, sampleRate: number): MacroAudioInput {
	const frames = value.channels[0]?.length ?? 0;
	if (value.sampleRate !== sampleRate || !frames || frames > sampleRate * 30
		|| value.channels.length < 1 || value.channels.length > 2 || frames * value.channels.length * 4 > 16 * 1024 * 1024
		|| value.channels.some(channel => !(channel instanceof Float32Array) || channel.length !== frames || channel.some(sample => !Number.isFinite(sample)))) {
		throw new RangeError('Choose an audio example up to 30 seconds long with one or two channels.');
	}
	return { name: String(value.name).slice(0, 255), sampleRate, channels: value.channels.map(channel => channel.slice()) };
}
