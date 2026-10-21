/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { encodeWav } from '../src/common/editor/wav.js';
import { inspectWavBlobPcm } from '../src/common/editor/wav-import.js';

test('a CART script containing ASCII tabs retains its continuity metadata on WAV import and delivery', async () => {
	const script = 'HOST\tRead the station identification.\r\n';
	const bytes = encodeWav([new Float32Array(48)], { sampleRate: 48_000,
		cart: { title: 'Station identification', cutId: 'ID-001', tagText: script.replace('\t', ' '),
			postTimers: [{ usage: 'EOD ', value: 48 }] } });
	const textOffset = Buffer.from(bytes).indexOf('HOST Read the station identification.');
	assert.ok(textOffset > 0);
	bytes[textOffset + 4] = 9;
	const imported = await inspectWavBlobPcm(new Blob([Uint8Array.from(bytes)]));
	assert.ok(imported);
	assert.equal(imported.cart?.title, 'Station identification');
	assert.equal(imported.cart?.tagText, script);
	assert.deepEqual(imported.cart?.postTimers, [{ usage: 'EOD ', value: 48 }]);
	const delivered = encodeWav([new Float32Array(48)], { sampleRate: 48_000, cart: imported.cart });
	const reread = await inspectWavBlobPcm(new Blob([Uint8Array.from(delivered)]));
	assert.ok(reread);
	assert.equal(reread.cart?.tagText, script);
});
