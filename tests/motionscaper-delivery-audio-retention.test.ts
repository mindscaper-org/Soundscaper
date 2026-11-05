/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createMotionMaximumIndexFixture } from '../desktop/motionscaper-native-maximum-index-fixture.ts';
import { createMotionMediaProvider } from '../src/common/editor/motion-media-provider.ts';
import { createMotionAudioMixer } from '../src/common/editor/motion-audio-mixer.ts';
import { createMotionscaperDeliveryAudioMixer } from '../src/motionscaper/editor-render-delivery.ts';

const request = { compositionId: 'main', sampleRate: 48000, channels: 2 as const };
const sampleAt = (index: number) => ((index % 1_920_000) % 127 - 63) / 128;

test('production delivery audio releases historical windows while preserving sequential PCM and every retained-source reset', async () => {
	const { revision, bodies } = createMotionMaximumIndexFixture(); let loads = 0;
	const provider = createMotionMediaProvider({ loadAsset: () => { loads++; return Promise.resolve(bodies.get('sound')!); } });
	const mixer = createMotionscaperDeliveryAudioMixer({ project: revision.project, provider });
	try {
		const starts = [...Array.from({ length: 16 }, (_, index) => index * 1600),
			...Array.from({ length: 27 }, (_, index) => (index + 1) * 1_920_000 - 4)];
		for (const startSample of starts) {
			const sampleCount = startSample < 25600 ? 1600 : 8;
			const block = await mixer.mixBlock({ ...request, startSample, sampleCount });
			for (let index = 0; index < sampleCount; index++) {
				const expected = sampleAt(startSample + index);
				assert.equal(block.interleaved[index * 2], expected);
				assert.equal(block.interleaved[index * 2 + 1], -expected || 0);
			}
			assert.ok(mixer.snapshot().cacheBytes <= 3 * 32768, 'Sequential export must retain only windows used by its latest block, including a source reset.');
		}
		assert.equal(loads, 1);
		await mixer.mixBlock({ ...request, startSample: 32769 * 1600, sampleCount: 8 });
		assert.equal(mixer.snapshot().cacheBytes, 0, 'A silent block releases windows from previous audio.');
	} finally { mixer.dispose(); provider.dispose(); }
	assert.equal(mixer.snapshot().cacheBytes, 0);
});

test('production delivery retains all simultaneous source windows and reuses them without an arbitrary per-asset cap', async () => {
	const { revision, bodies } = createMotionMaximumIndexFixture(); let reads = 0;
	const provider = createMotionMediaProvider({ loadAsset: () => Promise.resolve(bodies.get('sound')!) });
	const composition = revision.project.compositions[0]!;
	const project = { ...revision.project, compositions: [{ ...composition,
		audio: Array.from({ length: 8 }, (_, index) => ({ ...composition.audio[0]!, id: `voice-${index}`, sourceStart: { num: index, den: 1 } })),
	}] };
	const mixer = createMotionscaperDeliveryAudioMixer({ project, provider: { ...provider, async read(input, signal) { reads++; return provider.read(input, signal); } } });
	try {
		for (let repeat = 0; repeat < 2; repeat++) {
			const block = await mixer.mixBlock({ ...request, startSample: 100, sampleCount: 16 });
			for (let index = 0; index < 16; index++) {
				const expected = Array.from({ length: 8 }, (_, voice) => sampleAt(voice * 48000 + 100 + index)).reduce((sum, value) => sum + value, 0);
				assert.equal(block.interleaved[index * 2], expected);
				assert.equal(block.interleaved[index * 2 + 1], -expected || 0);
			}
			assert.equal(mixer.snapshot().cacheWindows, 8);
			assert.equal(reads, 8, 'All active windows remain cached for the next block.');
		}
	} finally { mixer.dispose(); provider.dispose(); }
});

test('delivery cancellation releases abandoned cache windows and permits an exact retry', async () => {
	const { revision, bodies } = createMotionMaximumIndexFixture();
	const provider = createMotionMediaProvider({ loadAsset: () => Promise.resolve(bodies.get('sound')!) });
	const cancellation = new AbortController(); let cancelRead = false;
	const mixer = createMotionscaperDeliveryAudioMixer({ project: revision.project, provider: { ...provider,
		async read(input, signal) {
			if (cancelRead) { cancelRead = false; cancellation.abort(new DOMException('Cancelled audio', 'AbortError')); signal?.throwIfAborted(); }
			return provider.read(input, signal);
		},
	} });
	try {
		await mixer.mixBlock({ ...request, startSample: 100, sampleCount: 16 });
		cancelRead = true;
		await assert.rejects(mixer.mixBlock({ ...request, startSample: 96000, sampleCount: 16 }, cancellation.signal), { name: 'AbortError' });
		assert.equal(mixer.snapshot().rendering, false);
		assert.equal(mixer.snapshot().cacheBytes, 0);
		const retry = await mixer.mixBlock({ ...request, startSample: 96000, sampleCount: 16 });
		for (let index = 0; index < 16; index++) assert.equal(retry.interleaved[index * 2], sampleAt(96000 + index));
	} finally { mixer.dispose(); provider.dispose(); }
});

test('non-delivery audio keeps its bounded seek cache across mix blocks', async () => {
	const { revision, bodies } = createMotionMaximumIndexFixture(); let reads = 0;
	const provider = createMotionMediaProvider({ loadAsset: () => Promise.resolve(bodies.get('sound')!) });
	const mixer = createMotionAudioMixer({ project: revision.project, provider: { ...provider, async read(input, signal) { reads++; return provider.read(input, signal); } } });
	try {
		for (const startSample of [100, 96000, 100]) {
			const block = await mixer.mixBlock({ ...request, startSample, sampleCount: 16 });
			assert.equal(block.interleaved[0], sampleAt(startSample));
		}
		assert.equal(reads, 2, 'Returning to a previous preview window does not decode it again.');
		assert.equal(mixer.snapshot().cacheWindows, 2);
	} finally { mixer.dispose(); provider.dispose(); }
});
