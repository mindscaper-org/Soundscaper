/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { ClipTimePitchRenderCacheCoordinator } from '../src/common/editor/clip-time-pitch-cache.js';
import {
	FakeStaffPadClient,
	clipFixture,
	sourceFixture,
	sourceStore,
} from './helpers/clip-time-pitch-cache-fixture.js';

test('an active playback resolver keeps its buffers when replacement renders publish or clips retire', async () => {
	const store = await sourceStore('playback-generation');
	const cache = new ClipTimePitchRenderCacheCoordinator({ store, client: new FakeStaffPadClient() });
	try {
		const source = sourceFixture();
		const firstClip = clipFixture({ pitchCents: 100 });
		const secondClip = clipFixture({ id: 'other', pitchCents: 200 });
		const first = await cache.prepareCommittedOutput(firstClip, source);
		const second = await cache.prepareCommittedOutput(secondClip, source);
		const oldBuffer = bufferFixture(first.frameCount);
		const removedBuffer = bufferFixture(second.frameCount);
		cache.attachAudioBuffer(first.cacheKey, oldBuffer);
		cache.attachAudioBuffer(second.cacheKey, removedBuffer);
		const resolver = cache.createEngineSourceResolver();
		const active = resolver.snapshot();

		const changedClip = { ...firstClip, speedRatio: 0.5, durationFrames: 32 };
		const replacement = await cache.prepareCommittedOutput(changedClip, source);
		const newBuffer = bufferFixture(replacement.frameCount);
		cache.attachAudioBuffer(replacement.cacheKey, newBuffer);
		cache.retainClipIds([firstClip.id]);

		assert.equal(active(firstClip)?.buffer, oldBuffer);
		assert.equal(active(secondClip)?.buffer, removedBuffer, 'even clips first reached on a later loop keep their buffers');
		assert.equal(resolver.snapshot()(changedClip)?.buffer, newBuffer);
		assert.equal(resolver(secondClip), null);
	} finally {
		await cache.dispose();
		await store.close();
	}
});

function bufferFixture(length: number) {
	return { length, numberOfChannels: 1, sampleRate: 8_000, getChannelData: () => new Float32Array(length) };
}
