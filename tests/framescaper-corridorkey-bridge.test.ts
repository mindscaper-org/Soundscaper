/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { lazyLocalAssistanceVideoKeyingBridge } from '../src/common/editor/assistance/local-assistance-video-keying-bridge.ts';

const request = { contractVersion: 1 as const, jobId: '01'.repeat(20), sourceId: 'source', frameRate: { num: 10, den: 1 }, outputs: [] };
function response() {
	return { contractVersion: 1, jobId: request.jobId, sourceId: request.sourceId,
		claim: { claimVersion: 1, claimId: '02'.repeat(20), jobId: request.jobId, role: 'keyed-video', mediaType: 'video/webm', byteLength: 200, sha256: 'ab'.repeat(32) },
		inspection: { width: 16, height: 8, frameCount: 2, frameRate: request.frameRate, sha256: 'ab'.repeat(32),
			timing: { timescale: 1_000, presentationTicks: ['0', '100'], finalFrameDurationTicks: '100' },
			characteristics: { videoCodec: 'vp9', hasAlpha: true, bitDepth: 8, pixelFormat: 'yuva420p',
				colorPrimaries: 'bt709', colorTransfer: 'bt709', colorSpace: 'bt709', colorRange: 'limited' } } };
}
test('the exact native keyed-video wire result becomes valid persisted alpha characteristics and timing', async () => {
	const port = lazyLocalAssistanceVideoKeyingBridge({ available: async () => true, encode: async () => response() });
	assert.ok(port); assert.equal(await port.available(), true);
	const result = await port.encode(request);
	assert.deepEqual(result.inspection.frameRate, request.frameRate);
	assert.equal(result.inspection.timing.presentationTicks.length, 2);
	assert.equal(result.inspection.timing.presentationTicks[1], 100n);
	assert.equal(result.inspection.characteristics.hasAlpha, true);
	assert.equal(result.inspection.characteristics.alphaMode, 'straight');
	assert.equal(result.inspection.characteristics.colour.transfer, 'bt709');
	assert.equal(result.inspection.characteristics.colour.range, 'limited');
	assert.equal(result.inspection.characteristics.codedWidth, 16);
	assert.deepEqual(result.inspection.characteristics.audioStreams, []);
});
test('the encoder capability requires a truthful availability response', async () => {
	assert.equal(lazyLocalAssistanceVideoKeyingBridge({ encode: async () => response() }), null);
	const port = lazyLocalAssistanceVideoKeyingBridge({ available: async () => 'yes', encode: async () => response() });
	assert.ok(port); await assert.rejects(port.available(), /availability/u);
});
test('wrong native job identity, content digest, alpha or timing is rejected before source publication', async () => {
	for (const change of [(value: ReturnType<typeof response>) => { value.jobId = '03'.repeat(20); },
		(value: ReturnType<typeof response>) => { value.inspection.sha256 = 'cd'.repeat(32); },
		(value: ReturnType<typeof response>) => { value.inspection.characteristics.hasAlpha = false; },
		(value: ReturnType<typeof response>) => { value.inspection.timing.presentationTicks = ['0', '0']; }]) {
		const value = response(); change(value);
		const port = lazyLocalAssistanceVideoKeyingBridge({ available: async () => true, encode: async () => value });
		assert.ok(port); await assert.rejects(port.encode(request));
	}
});
