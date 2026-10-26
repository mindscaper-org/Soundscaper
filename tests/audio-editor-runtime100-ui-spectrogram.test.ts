/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { generateSpectrogramPcmTiles } from '../src/common/editor/ui/timeline/spectrogram-pcm-tiles.ts';

async function tileFixture() {
	let geometryReads = 0;
	const clip = { id: 'c', sourceId: 's', timelineStartFrame: 0, durationFrames: 640, get sourceStartFrame() { geometryReads++; return 0; }, sourceDurationFrames: 640, waveformStartFrame: 0, waveformEndFrame: 640 };
	const requests: [number, number][] = [];
	const result = await generateSpectrogramPcmTiles({ clip, width: 256, fftWindowSize: 32, maximumSourceFrames: 1024,
		requestPcmWindow(startFrame, endFrame) { requests.push([startFrame, endFrame]); return Promise.resolve({ startFrame, endFrame, channels: [new Float32Array(endFrame - startFrame)] }); },
		analyze(_view, _width, options) { return Array.from({ length: Math.ceil((options.pixelEnd - options.pixelStart) / options.pixelSkip) }, (_, i) => [options.pixelStart + i * options.pixelSkip]); },
	});
	return { result, geometryReads, requests };
}
void test('U36 spectrogram tile planning prepares unwarped source geometry once per candidate-window batch', async t => {
	const { result, geometryReads, requests } = await tileFixture();
	assert.equal(result?.channels[0]?.length, 256); assert.equal(result?.channels[0]?.at(-1)?.[0], 255); assert.deepEqual(requests, [[0, 640]]);
	t.diagnostic(`source origin reads ${geometryReads}`); assert.ok(geometryReads <= 2);
});
void test('U37 spectrogram tile iteration derives integer-stride positions without materializing every pixel', async t => {
	let pushes = 0; const original = Array.prototype.push;
	Array.prototype.push = function<T>(this: T[], ...items: T[]) { if (items.length === 1 && typeof items[0] === 'number') pushes++; return original.apply(this, items); };
	try { assert.equal((await tileFixture()).result?.channels[0]?.length, 256); } finally { Array.prototype.push = original; }
	t.diagnostic(`boxed pixel position pushes ${pushes}`); assert.equal(pushes, 0);
});
