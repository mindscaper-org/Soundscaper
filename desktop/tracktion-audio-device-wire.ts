/* SPDX-License-Identifier: AGPL-3.0-only */

import { readClosedDomainArray, readClosedDomainRecord } from '../src/common/foundation/closed-domain-value.ts';
import type {
	TracktionAppliedAudioSetup, TracktionAudioDeviceCommand, TracktionAudioDeviceReply, TracktionAudioSetup, TracktionDeviceChoice,
} from '../src/soundscaper/tracktion-audio-device-contract.ts';

export const tracktionAudioSetupFields = ['hostId', 'outputId', 'inputId', 'inputChannel', 'outputChannel', 'sampleRate', 'blockSize'] as const;

export function readTracktionAudioDeviceId(value: unknown, allowsDefault: boolean): string {
	if (typeof value !== 'string' || (!(allowsDefault && value === '') && !/^[0-9a-f]{16}$/u.test(value))) {
		throw new TypeError('Invalid Tracktion audio device handle.');
	}
	return value;
}

function integer(value: unknown, minimum: number, maximum: number): number {
	if (typeof value !== 'number' || !Number.isInteger(value) || value < minimum || value > maximum) {
		throw new TypeError('Invalid Tracktion audio device setting.');
	}
	return value;
}

export function readTracktionAudioSetup(fields: Readonly<Record<string, unknown>>): TracktionAudioSetup {
	return Object.freeze({
		hostId: readTracktionAudioDeviceId(fields.hostId, false),
		inputId: readTracktionAudioDeviceId(fields.inputId, true),
		outputId: readTracktionAudioDeviceId(fields.outputId, true),
		inputChannel: integer(fields.inputChannel, 0, 63),
		outputChannel: integer(fields.outputChannel, 0, 62),
		sampleRate: fields.sampleRate === 0 ? 0 : integer(fields.sampleRate, 22_050, 192_000),
		blockSize: integer(fields.blockSize, 0, 8192),
	});
}

function choices(value: unknown, maximum: number): readonly TracktionDeviceChoice[] {
	return Object.freeze(readClosedDomainArray(value, 'Tracktion audio devices', 0, maximum).map((raw) => {
		const { id, name } = readClosedDomainRecord(raw, 'Tracktion audio device', ['id', 'name']);
		if (typeof name !== 'string' || !name || Buffer.byteLength(name) > 512) throw new TypeError('Invalid Tracktion audio device name.');
		return Object.freeze({ id: readTracktionAudioDeviceId(id, false), name });
	}));
}

function appliedSetup(value: unknown): TracktionAppliedAudioSetup {
	const { setup, actualSampleRate, actualBlockSize } = readClosedDomainRecord(
		value, 'Tracktion audio setup', ['setup', 'actualSampleRate', 'actualBlockSize'],
	);
	return Object.freeze({
		setup: readTracktionAudioSetup(readClosedDomainRecord(setup, 'Tracktion audio settings', tracktionAudioSetupFields)),
		actualSampleRate: integer(actualSampleRate, 22_050, 192_000),
		actualBlockSize: integer(actualBlockSize, 1, 65_536),
	});
}

export function readTracktionAudioDeviceReply<Command extends TracktionAudioDeviceCommand>(
	value: unknown, command: Command,
): TracktionAudioDeviceReply<Command> {
	if (command.kind === 'audioHosts') {
		const { hosts, selected } = readClosedDomainRecord(value, 'Tracktion audio hosts', ['hosts', 'selected']);
		return Object.freeze({
			hosts: choices(hosts, 16), selected: selected === null ? null : appliedSetup(selected),
		}) as TracktionAudioDeviceReply<Command>;
	}
	if (command.kind === 'audioDevices') {
		const { inputs, outputs, separateDevices } = readClosedDomainRecord(
			value, 'Tracktion audio endpoints', ['inputs', 'outputs', 'separateDevices'],
		);
		if (typeof separateDevices !== 'boolean') throw new TypeError('Invalid Tracktion audio routing mode.');
		return Object.freeze({ inputs: choices(inputs, 64), outputs: choices(outputs, 64), separateDevices }) as TracktionAudioDeviceReply<Command>;
	}
	const applied = appliedSetup(value);
	const submitted = readTracktionAudioSetup({ ...command });
	for (const key of tracktionAudioSetupFields) {
		if (applied.setup[key] !== submitted[key]) throw new TypeError('Tracktion applied different audio settings.');
	}
	if ((submitted.sampleRate !== 0 && submitted.sampleRate !== applied.actualSampleRate)
		|| (submitted.blockSize !== 0 && submitted.blockSize !== applied.actualBlockSize)) {
		throw new TypeError('Tracktion opened a different audio format.');
	}
	return applied as TracktionAudioDeviceReply<Command>;
}
