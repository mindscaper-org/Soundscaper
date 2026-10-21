/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { audioMetadataComments } from '../src/common/editor/audio-metadata-values.ts';
import { createAudioMetadataId3Tag } from '../src/common/editor/id3-metadata.js';
import { normalizeMediaMetadata } from '../src/common/editor/media-metadata.ts';
import { createExportDialogInitialSettings } from '../src/common/editor/ui/export-dialog-initial-settings.ts';
import { createExportDialogRequest } from '../src/common/editor/ui/export-dialog-model.js';
import { exportDialogMetadata } from '../src/common/editor/ui/export-dialog-audio-codec-options.ts';

function dialogMetadata(custom: Readonly<Record<string, string>>, format = 'wav'): Readonly<Record<string, string>> {
	const settings = { ...createExportDialogInitialSettings({ sampleRate: 48_000 }), format, metadataCustom: JSON.stringify(custom) };
	const request = createExportDialogRequest(settings, { metadata: exportDialogMetadata(format, false,
		JSON.parse(settings.metadataCustom) as Readonly<Record<string, string>>) });
	return normalizeMediaMetadata(request.metadata);
}
function frames(bytes: Uint8Array): Readonly<{ id: string; payload: Uint8Array }>[] {
	const result = [];
	for (let offset = 10; offset + 10 <= bytes.length;) {
		const length = bytes.subarray(offset + 4, offset + 8).reduce((sum, byte) => sum * 128 + byte, 0);
		result.push({ id: new TextDecoder().decode(bytes.subarray(offset, offset + 4)), payload: bytes.subarray(offset + 10, offset + 10 + length) });
		offset += 10 + length;
	}
	return result;
}

test('a constructor-named Custom Metadata field keeps its literal key in comment-based exports', () => {
	assert.deepEqual(audioMetadataComments(dialogMetadata({ constructor: 'Ensemble' }, 'flac')), ['CONSTRUCTOR=Ensemble']);
});

test('ID3 Custom Metadata companion aliases retain the requested language, description, and identifier owner', () => {
	const metadata = dialogMetadata({ COMMENTS: 'Message', COMMENTLANGUAGE: 'fra', COMMENTDESCRIPTION: 'Review',
		uniqueIdentifier: 'asset-1', IDENTIFIEROWNER: 'https://example.org/catalog' });
	const tag = frames(createAudioMetadataId3Tag(metadata));
	const comment = tag.find(frame => frame.id === 'COMM');
	assert.ok(comment);
	assert.equal(new TextDecoder().decode(comment.payload.subarray(1)), 'fraReview\0Message');
	assert.equal(new TextDecoder().decode(tag.find(frame => frame.id === 'UFID')?.payload), 'https://example.org/catalog\0asset-1');
});

test('ID3 comment aliases export one standard comment while retaining the secondary custom value', () => {
	for (const custom of [{ comment: 'Secondary', comments: 'Primary' }, { comments: 'Primary', comment: 'Secondary' }]) {
		const tag = frames(createAudioMetadataId3Tag(dialogMetadata(custom)));
		const comments = tag.filter(frame => frame.id === 'COMM');
		assert.equal(comments.length, 1);
		assert.equal(new TextDecoder().decode(comments[0]?.payload.subarray(1)), 'eng\0Primary');
		assert.ok(tag.some(frame => frame.id === 'TXXX' && new TextDecoder().decode(frame.payload.subarray(1)) === 'comment\0Secondary'));
	}
});
