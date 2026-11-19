/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { createSherpaVadFactory } from '../desktop/assistance-sherpa-vad.ts';
import { normalizeVoiceActivityResult } from '../desktop/assistance-vad-runtime.ts';
import { writeSherpaVadWave } from './helpers/sherpa-vad-wave.ts';

test('Sherpa VAD reads the prepared file in exact windows across PCM block boundaries', async context => {
	const samples = Float32Array.from({ length: 65_536 + 513 }, (_, index) => (index % 31 - 15) / 32);
	const file = await writeSherpaVadWave(context, samples);
	let inputOffset = 0;
	let inferenceCalls = 0;
	const detector = createSherpaVadFactory({
		readWave() { assert.fail('The worker must not load the complete WAV into the native runtime.'); },
		Vad: class {
			acceptWaveform(input: Float32Array) {
				const length = Math.min(512, samples.length - inputOffset);
				if (length > 0) {
					assert.deepEqual(input, samples.subarray(inputOffset, inputOffset + length));
					inputOffset += length;
				} else assert.deepEqual(input, new Float32Array(575));
				inferenceCalls += 1;
			}
			isEmpty() { return true; }
			pop() {}
			flush() {}
			clear() {}
		},
	});
	const result = await detector.detect({ ...file, model: { model: '/private/silero.onnx' } });
	assert.deepEqual(result.segments, []);
	assert.equal(inputOffset, samples.length);
	assert.equal(inferenceCalls, 131);
});

test('Sherpa VAD measures exact speech sample ranges from authenticated 16 kHz audio', async context => {
	const file = await writeSherpaVadWave(context, new Float32Array(4_096));
	const configurations: unknown[] = [];
	const accepted: number[] = [];
	let flushed = false;
	let cleared = false;
	const queued = [
		{ start: 512, samples: new Float32Array(800) },
		{ start: 2_048, samples: new Float32Array(1_024) },
	];
	const runtime = {
		Vad: class {
			constructor(config: unknown, bufferSeconds: number) {
				configurations.push({ config, bufferSeconds });
			}
			acceptWaveform(samples: Float32Array) { accepted.push(samples.length); }
			isEmpty() { return queued.length === 0; }
			front(enableExternalBuffer = true) {
				assert.equal(enableExternalBuffer, false, 'Electron requires V8-owned segment buffers');
				return queued[0];
			}
			pop() { queued.shift(); }
			flush() { flushed = true; }
			clear() { cleared = true; }
		},
	};
	const progress: unknown[] = [];
	const detector = createSherpaVadFactory(runtime);

	const result = await detector.detect({
		...file,
		modelId: 'silero-vad-v6',
		model: { model: '/private/silero_vad.onnx' },
		onProgress: (value) => progress.push(value),
	});

	assert.deepEqual(result, {
		sampleRate: 16_000,
		segments: [
			{ startSample: 512, sampleCount: 800 },
			{ startSample: 2_048, sampleCount: 1_024 },
		],
	});
	assert.deepEqual(accepted, [...Array(8).fill(512), 64]);
	assert.deepEqual(progress.at(-1), { completed: 4_096, total: 4_096 });
	assert.equal(flushed, true);
	assert.equal(cleared, true);
	assert.deepEqual(configurations, [{
		config: {
			sileroVad: {
				model: '/private/silero_vad.onnx', threshold: 0.5,
				minSilenceDuration: 0.5, minSpeechDuration: 0.25,
				windowSize: 512, maxSpeechDuration: 30,
			},
			sampleRate: 16_000, numThreads: 2, provider: 'cpu', debug: 0,
		},
		bufferSeconds: 60,
	}]);
});

test('Sherpa VAD finishes the terminal speech window without extending selection or progress', async context => {
	const source = new Float32Array(16_001).fill(0.25);
	const file = await writeSherpaVadWave(context, source);
	const finalWindows: Float32Array[] = [];
	const progress: unknown[] = [];
	let received = 0;
	const detector = createSherpaVadFactory({
		Vad: class {
			ready = false;
			acceptWaveform(samples: Float32Array) {
				if (received >= 15_872) finalWindows.push(samples);
				received += samples.length;
			}
			isEmpty() { return !this.ready; }
			front() { return { start: 4_576, samples: new Float32Array(16_384 - 4_576) }; }
			pop() { this.ready = false; }
			flush() { this.ready = received === 16_384 + 64; }
			clear() { this.ready = false; }
		},
	});
	const result = await detector.detect({
		...file, model: { model: '/private/silero.onnx' },
		onProgress: value => progress.push(value),
	});

	assert.deepEqual(result.segments, [{ startSample: 4_576, sampleCount: 16_001 - 4_576 }]);
	assert.deepEqual(finalWindows, [source.subarray(15_872), new Float32Array(447)]);
	assert.deepEqual(progress.at(-1), { completed: 16_001, total: 16_001 });
});

test('Sherpa VAD rejects non-16 kHz input instead of changing timing authority', async context => {
	const file = await writeSherpaVadWave(context, new Float32Array(8), 48_000);
	const detector = createSherpaVadFactory({
		Vad: class { constructor() { throw new Error('must not construct'); } },
	});
	await assert.rejects(detector.detect({
		...file, model: { model: '/private/silero.onnx' },
	}), /mono IEEE Float32/iu);
});

test('voice-activity result admission rejects overlapping or out-of-order segments', () => {
	assert.throws(() => normalizeVoiceActivityResult({
		sampleRate: 16_000,
		segments: [
			{ startSample: 100, sampleCount: 100 },
			{ startSample: 199, sampleCount: 10 },
		],
	}), /ordered and disjoint/iu);
});
