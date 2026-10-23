/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { inspectImportedMediaMetadata } from '../src/common/editor/imported-media-metadata.ts';
import { readApeMetadataTags } from '../src/common/editor/ape-metadata-reader.ts';
import { createApeFileMetadata } from '../src/common/editor/ape-file-metadata.ts';
import { createAudacityWavPackFixture, createMultiValueWavPackFixture } from './helpers/wavpack-import-fixture.ts';

test('APEv2 imports descriptive lists and uses the first scalar value while retaining exact raw text', async () => {
	const inspected = await inspectImportedMediaMetadata(await createMultiValueWavPackFixture());
	assert.deepEqual(inspected.warnings, []);
	assert.deepEqual(inspected.metadata.normalized, { title: 'Two credited performers', artist: 'Ada; Béla',
		comment: 'First note; Second note', trackNumber: 3, date: '2026-10-23' });
	assert.equal(inspected.metadata.raw?.ARTIST, 'Ada\0Béla');
	assert.equal(inspected.metadata.raw?.TRACKNUMBER, '3\0Alternate track');
	assert.equal(inspected.metadata.raw?.CUSTOM, 'One\0Two');
});

test('ordinary single APE text values and position/total pairs remain exact', async () => {
	const file = new File([await createAudacityWavPackFixture(4800), createApeFileMetadata({ artist: 'Ada', track: '3/12', date: '2026-10-23' })], 'Single.wv');
	assert.deepEqual(await readApeMetadataTags(file), { raw: { ARTIST: 'Ada', TRACKNUMBER: '3', TRACKTOTAL: '12', DATE: '2026-10-23' },
		artist: 'Ada', trackNumber: 3, tracksTotal: 12, date: '2026-10-23' });
});
