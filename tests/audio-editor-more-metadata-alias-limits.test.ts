/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createAudioMetadataId3Tag } from '../src/common/editor/id3-metadata.js';
import { normalizeMediaExportSettings } from '../src/common/editor/media-export.js';
import { createExportDialogInitialSettings } from '../src/common/editor/ui/export-dialog-initial-settings.ts';
import { createExportDialogRequest } from '../src/common/editor/ui/export-dialog-model.js';
import { exportDialogMetadata } from '../src/common/editor/ui/export-dialog-audio-codec-options.ts';

function exportTag(key: string, value: string): Uint8Array {
	const settings = { ...createExportDialogInitialSettings({ sampleRate: 48_000 }), format: 'wav',
		metadataCustom: JSON.stringify({ [key]: value }) };
	const request = createExportDialogRequest(settings, { metadata: exportDialogMetadata(settings.format, false,
		JSON.parse(settings.metadataCustom) as Readonly<Record<string, string>>) });
	return createAudioMetadataId3Tag(normalizeMediaExportSettings(settings.format, request).metadata);
}

for (const [alias, canonical, frame] of [['LYRICS', 'lyrics', 'USLT'], ['TERMS_OF_USE', 'termsOfUse', 'USER'],
	['SYNCHRONIZED_LYRICS', 'synchronizedLyrics', 'SYLT']] as const) {
	test(`Custom Metadata ${alias} retains the same long text as its canonical ${canonical} field`, () => {
		const value = canonical === 'synchronizedLyrics'
			? Array.from({ length: 180 }, (_, index) => `[${Math.floor(index / 60)}:${String(index % 60).padStart(2, '0')}.000]A complete line of song lyrics`).join('\n')
			: 'A complete line of song lyrics.\n'.repeat(180);
		assert.ok(value.length > 4096 && value.length < 65_536);
		const expected = exportTag(canonical, value);
		const actual = exportTag(alias, value);
		assert.deepEqual(actual, expected, `${frame} must preserve the same complete text through the actual export request`);
		assert.equal(new TextDecoder().decode(actual.subarray(10, 14)), frame);
	});
}

test('standard long-text aliases retain their field limits and control-character checks', () => {
	assert.throws(() => exportTag('LYRICS', 'x'.repeat(65_537)), /too long/u);
	assert.throws(() => exportTag('LYRICS', 'one\0two'), /control characters/u);
	assert.throws(() => exportTag('CUSTOM', 'x'.repeat(4097)), /too long/u);
});
