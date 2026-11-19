/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { hasClassicAvcDecoderConfiguration } from '../src/common/editor/video-avc-decoder-admission.ts';
import { sourceMonitorFragmentedMedia } from './browser/fixtures/video-timing-probe-media.js';

test('only a classic AVC1 track with one active sample description admits decoder configuration projection', async () => {
	const [classic, fragmented, hybrid] = sourceMonitorFragmentedMedia();
	const signal = new AbortController().signal;
	const admit = (buffer: Uint8Array, trackId = 1) => hasClassicAvcDecoderConfiguration(
		new Blob([Uint8Array.from(buffer)], { type: 'video/mp4' }), trackId, signal,
	);
	assert.equal(await admit(classic!.buffer), true);
	assert.equal(await admit(classic!.buffer, 2), false);
	assert.equal(await admit(fragmented!.buffer), false);
	assert.equal(await admit(hybrid!.buffer), false);

	const inBand = Buffer.from(classic!.buffer);
	const description = inBand.indexOf('stsd') + 16;
	assert.equal(inBand.toString('ascii', description, description + 4), 'avc1');
	inBand.write('avc3', description);
	assert.equal(await admit(inBand), false);

	const alternate = Buffer.from(classic!.buffer);
	const stsc = alternate.indexOf('stsc');
	assert.equal(alternate.readUInt32BE(stsc + 8), 2);
	const descriptionIndex = stsc + 32;
	assert.equal(alternate.readUInt32BE(descriptionIndex), 1);
	alternate.writeUInt32BE(2, descriptionIndex);
	assert.equal(await admit(alternate), false);
});
