/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { encodeWav } from '../src/common/editor/wav.js';
import { inspectWavBlobPcm } from '../src/common/editor/wav-import.js';
import { createBextMetadataEditorValue } from '../src/common/editor/ui/bext-metadata-editor-model.ts';

test('imported BEXT date and time separators become valid native editor values', async () => {
	for (const separator of ['.', ' ', '_', '/', ':']) {
		const bytes = encodeWav([new Float32Array(48)], { sampleRate: 48_000,
			bext: { originationDate: `2026${separator}02${separator}03`, originationTime: `04${separator}05${separator}06` } });
		const descriptor = await inspectWavBlobPcm(new Blob([Uint8Array.from(bytes)]));
		assert.ok(descriptor?.bext);
		const value = createBextMetadataEditorValue({ metadata: { bext: descriptor.bext } });
		assert.equal(value.originationDate, '2026-02-03');
		assert.equal(value.originationTime, '04:05:06');
	}
});
