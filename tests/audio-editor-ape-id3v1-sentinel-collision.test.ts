/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createApeFileMetadata } from '../src/common/editor/ape-file-metadata.ts';
import { readApeMetadataTags, wavPackAudioBlob } from '../src/common/editor/ape-metadata-reader.ts';
import { inspectImportedMediaMetadata } from '../src/common/editor/imported-media-metadata.ts';
import { createAudacityWavPackFixture } from './helpers/wavpack-import-fixture.ts';

test('an APEv2 comment beginning TAG at the ID3v1 probe position remains ordinary metadata', async () => {
	const raw = await createAudacityWavPackFixture(4800);
	const comment = `TAG${'field notes '.repeat(9)}`.slice(0, 96);
	assert.equal(comment.length, 96);
	const file = new File([raw, createApeFileMetadata({ title: 'Actual title', artist: 'Actual artist', comment })], 'Field notes.wv');
	assert.equal(new TextDecoder().decode(await file.slice(-128, -125).arrayBuffer()), 'TAG');
	const tags = await readApeMetadataTags(file);
	assert.equal(tags.title, 'Actual title');
	assert.equal(tags.artist, 'Actual artist');
	assert.equal(tags.comment, comment);
	assert.deepEqual(new Uint8Array(await (await wavPackAudioBlob(file)).arrayBuffer()), raw);
	const inspection = await inspectImportedMediaMetadata(file);
	assert.deepEqual(inspection.warnings, []);
	assert.equal(inspection.metadata.normalized?.title, 'Actual title');
});
