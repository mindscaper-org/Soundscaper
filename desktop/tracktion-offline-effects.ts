/* SPDX-License-Identifier: AGPL-3.0-only */

import { readClosedDomainRecord } from '../src/common/foundation/closed-domain-value.ts';

export type TracktionOfflineEffectIdentity = Readonly<{ format: string; stableId: string; sha256: string }>;
export type TracktionStereoBlock = readonly [Float32Array, Float32Array];

export interface TracktionOfflineEffectInstance {
	readonly latencyFrames: number;
	process(input: TracktionStereoBlock, output: TracktionStereoBlock): Promise<void>;
	close(): Promise<void>;
}

/** Installed effect resolution and isolation belong to the trusted desktop host. */
export interface TracktionOfflineEffectHost {
	openStereo(identity: TracktionOfflineEffectIdentity, rate: number, maximumFrames: number): Promise<TracktionOfflineEffectInstance | null>;
}

export interface TracktionOfflineEffectRender {
	respond(message: unknown): Promise<unknown>;
	dispose(): Promise<void>;
}

const MAXIMUM_FRAMES = 128;
const MAXIMUM_LATENCY = 1_048_576;
const COMMON_FIELDS = ['kind', 'operation', 'instance', 'sequence'] as const;
const FORMATS = new Set(['clap', 'vst3', 'vst2', 'au', 'ladspa', 'lv2']);

export function createTracktionOfflineRender(host?: TracktionOfflineEffectHost): TracktionOfflineEffectRender {
	const instances = new Map<number, TracktionOfflineEffectInstance>();
	let sequence = 0;
	let created = 0;
	let disposed = false;

	async function respond(message: unknown) {
		const request = readClosedDomainRecord(message, 'Tracktion effect request', [
			...COMMON_FIELDS, 'format', 'stableId', 'sha256', 'sampleRate', 'maximumFrames', 'frames', 'pcm',
		], COMMON_FIELDS);
		if (disposed || request.kind !== 'offlineEffect' || request.sequence !== sequence + 1) {
			throw new TypeError('Invalid Tracktion effect request sequence.');
		}
		sequence += 1;
		const id = boundedInt(request.instance, 1, 2 ** 31 - 1);
		const reply = (ok: boolean, value: number | string | null = null) => ({
			kind: 'offlineEffectReply', sequence, ok, value,
		});
		switch (request.operation) {
			case 'open': {
				readClosedDomainRecord(message, 'Tracktion effect open', [
					...COMMON_FIELDS, 'format', 'stableId', 'sha256', 'sampleRate', 'maximumFrames',
				]);
				if (id !== created + 1 || request.maximumFrames !== MAXIMUM_FRAMES) {
					throw new TypeError('Invalid Tracktion effect instance or block size.');
				}
				created = id;
				const identity = readIdentity(request);
				const rate = boundedInt(request.sampleRate, 8_000, 192_000);
				try {
					const instance = await host?.openStereo(identity, rate, MAXIMUM_FRAMES);
					if (!instance) return reply(false);
					if (disposed) {
						await instance.close();
						return reply(false);
					}
					instances.set(id, instance);
					return reply(true, boundedInt(instance.latencyFrames, 0, MAXIMUM_LATENCY));
				} catch {
					return reply(false);
				}
			}
			case 'process': {
				readClosedDomainRecord(message, 'Tracktion effect process', [...COMMON_FIELDS, 'frames', 'pcm']);
				const instance = instances.get(id);
				if (!instance) throw new TypeError('Unknown Tracktion effect instance.');
				const frames = boundedInt(request.frames, 1, MAXIMUM_FRAMES);
				const input = readStereo(request.pcm, frames);
				const output = stereo(frames);
				try {
					await instance.process(input, output);
					return reply(true, writeStereo(output));
				} catch {
					return reply(false);
				}
			}
			case 'close': {
				readClosedDomainRecord(message, 'Tracktion effect close', COMMON_FIELDS);
				const instance = instances.get(id);
				if (!instance) throw new TypeError('Unknown Tracktion effect instance.');
				instances.delete(id);
				try {
					await instance.close();
					return reply(true);
				} catch {
					return reply(false);
				}
			}
			default: throw new TypeError('Unknown Tracktion effect operation.');
		}
	}

	async function dispose(): Promise<void> {
		disposed = true;
		const open = [...instances.values()];
		instances.clear();
		await Promise.allSettled(open.map(async (instance) => instance.close()));
	}
	return { respond, dispose };
}

function readIdentity(value: Record<string, unknown>): TracktionOfflineEffectIdentity {
	const { format, stableId, sha256 } = value;
	if (typeof format !== 'string' || !FORMATS.has(format) || typeof stableId !== 'string' || stableId.length === 0
		|| stableId.includes('\0') || Buffer.byteLength(stableId, 'utf8') > 512
		|| typeof sha256 !== 'string' || !/^[a-f0-9]{64}$/u.test(sha256)) {
		throw new TypeError('Invalid Tracktion effect installation identity.');
	}
	return { format, stableId, sha256 };
}

function boundedInt(value: unknown, minimum: number, maximum: number): number {
	if (typeof value !== 'number' || !Number.isInteger(value) || value < minimum || value > maximum) {
		throw new TypeError('Invalid Tracktion effect integer.');
	}
	return value;
}

function stereo(frames: number): TracktionStereoBlock {
	return [new Float32Array(frames), new Float32Array(frames)];
}

function readStereo(value: unknown, frames: number): TracktionStereoBlock {
	const length = frames * Float32Array.BYTES_PER_ELEMENT * 2;
	if (typeof value !== 'string' || value.length !== Math.ceil(length / 3) * 4) {
		throw new TypeError('Invalid Tracktion effect PCM length.');
	}
	const bytes = Buffer.from(value, 'base64');
	if (bytes.length !== length || bytes.toString('base64') !== value) throw new TypeError('Invalid Tracktion effect PCM encoding.');
	const output = stereo(frames);
	let offset = 0;
	for (const plane of output) {
		for (let frame = 0; frame < plane.length; frame += 1) {
			const sample = bytes.readFloatLE(offset);
			plane[frame] = sample;
			offset += Float32Array.BYTES_PER_ELEMENT;
		}
	}
	return output;
}

function writeStereo(planes: TracktionStereoBlock): string {
	const bytes = Buffer.alloc(planes[0].byteLength + planes[1].byteLength);
	let offset = 0;
	for (const plane of planes) {
		for (const sample of plane) {
			if (!Number.isFinite(sample)) throw new TypeError('Invalid Tracktion effect output sample.');
			bytes.writeFloatLE(sample, offset);
			offset += Float32Array.BYTES_PER_ELEMENT;
		}
	}
	return bytes.toString('base64');
}
