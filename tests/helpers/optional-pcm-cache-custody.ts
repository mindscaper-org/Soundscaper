/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import type { TestContext } from 'node:test';
import { createSoundscaperProject } from '../../src/soundscaper/editor-project.ts';
import { createSoundscaperScapeNativeRuntime } from '../../src/soundscaper/editor-scape-native.ts';
import { validateSoundscaperProject } from '../../src/soundscaper/editor-project-validation.ts';
import { createMemoryEngine } from './audio-editor-controller-harness.js';
import { MockAudioBuffer } from './mock-audio-context.js';
import { controllerSession } from './soundscaper-controller-session.ts';

type Overrides = NonNullable<Parameters<typeof controllerSession>[1]>;

/** Native AudioBuffer allocation is optional; recording transforms must use the actual durable PCM. */
export async function optionalPcmCacheSession(context: TestContext, overrides: Overrides = {}) {
	const engine = { ...createMemoryEngine(), async decodeAudioData() {
		throw new DOMException('Encoded import must use its shipping dedicated codec, not native decoding.', 'NotSupportedError');
	}, async getAudioContext() { return { sampleRate: 48_000,
		createBuffer(channels: number, frames: number, sampleRate: number) {
			if (sampleRate < 3_000 || sampleRate > 192_000) throw new DOMException('Native buffer rate unsupported.', 'NotSupportedError');
			return new MockAudioBuffer(channels, frames, sampleRate);
		},
	}; } };
	const session = await controllerSession(context, {
		engine: engine as unknown as Overrides['engine'],
		engineFactory: () => { throw new Error('Custody must not substitute a renderer for original source PCM.'); },
		scapeProjectRuntime: createSoundscaperScapeNativeRuntime(), ...overrides,
	});
	await session.controller.actions.project.open(createSoundscaperProject({ id: context.name, sampleRate: 48_000, masterChannels: 1 }));
	let cacheFailures = 0;
	const saveAnalysis = session.store.saveAnalysis.bind(session.store);
	session.store.saveAnalysis = async (key: string, value: unknown) => {
		if (key.startsWith('audio-editor-peaks-v2:')) {
			cacheFailures++;
			throw new DOMException('Waveform cache full', 'QuotaExceededError');
		}
		return saveAnalysis(key, value);
	};
	return { ...session, cacheFailures: () => cacheFailures };
}

export function audioProject(value: unknown) {
	assert.ok(validateSoundscaperProject(value));
	for (const source of value.sources) assert.equal(source.kind, 'audio');
	return value;
}

export function assertSine(channel: Float32Array, sampleRate: number, frequency: number, amplitude: number, tolerance = 1e-6): void {
	for (const [frame, sample] of channel.entries()) {
		const expected = amplitude * Math.sin(2 * Math.PI * frequency * frame / sampleRate);
		assert.ok(Math.abs(sample - expected) <= tolerance, `frame ${frame}: ${sample} must preserve authored sine ${expected}`);
	}
}
