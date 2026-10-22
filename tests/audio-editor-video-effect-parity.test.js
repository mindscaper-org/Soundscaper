import test from 'node:test';
import assert from 'node:assert/strict';
import {
	compareVideoEffectFrames,
	createVideoEffectParityFixture,
} from './browser/video-effect-parity-helpers.js';

test('video effect parity metrics are normalized per channel and detect structural changes', () => {
	const fixture = createVideoEffectParityFixture('gradient');
	const identical = compareVideoEffectFrames(fixture.bytes, fixture.bytes, fixture.width, fixture.height);
	assert.equal(identical.ssim, 1);
	assert.deepEqual(identical.channelMae, { red: 0, green: 0, blue: 0, alpha: 0 });
	assert.deepEqual(identical.channelMean.red, { preview: 0.5, export: 0.5 });

	const changed = fixture.bytes.slice();
	for (let offset = 0; offset < changed.length; offset += 4) changed[offset] = 255 - changed[offset];
	const metrics = compareVideoEffectFrames(changed, fixture.bytes, fixture.width, fixture.height);
	assert.ok(metrics.ssim < 0.95);
	assert.ok(metrics.channelMae.red > 0.2);
	assert.equal(metrics.channelMae.green, 0);
	assert.equal(metrics.channelMae.blue, 0);
	assert.equal(metrics.channelMae.alpha, 0);
});
