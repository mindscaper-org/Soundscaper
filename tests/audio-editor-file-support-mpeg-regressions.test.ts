/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { originalMpegExportSettings } from '../src/common/editor/desktop-original-mpeg-settings.ts';

function protectedVbrFrame(tagOffset: number): Uint8Array<ArrayBuffer> {
	const bytes = new Uint8Array(256);
	bytes.set([0xff, 0xfa, 0x90, 0]);
	bytes.set(new TextEncoder().encode('Xing'), tagOffset);
	const view = new DataView(bytes.buffer);
	view.setUint32(tagOffset + 4, 15);
	view.setUint32(tagOffset + 116, 70);
	bytes.set(new TextEncoder().encode('LAME3.100'), tagOffset + 120);
	return bytes;
}

test('Original MP3 export preserves VBR for both CRC-protected Xing layouts', () => {
	for (const offset of [36, 38]) {
		const settings = originalMpegExportSettings(protectedVbrFrame(offset), 'mp3', 160);
		assert.equal(settings?.bitRateMode, 'variable');
		assert.equal(settings?.vbrQuality, 3);
	}
});
