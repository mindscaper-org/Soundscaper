/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { inspectImportedMediaMetadata } from '../src/common/editor/imported-media-metadata.ts';
import { createReferenceWavPackFixture } from './helpers/wavpack-import-fixture.ts';

for (const type of [0, 1, 2] as const) test(`APE item type ${String(type)} retains its text or opaque representation`, async () => {
	const inspection = await inspectImportedMediaMetadata(await createReferenceWavPackFixture(type));
	assert.deepEqual(inspection.warnings, []);
	assert.equal(inspection.metadata.normalized?.title, 'Referenced performance');
	if (type === 1) {
		assert.deepEqual(inspection.metadata.raw?.RELATED, { attachmentPath: 'raw.RELATED' });
		assert.equal(inspection.attachments.length, 1);
	} else {
		assert.equal(inspection.metadata.raw?.RELATED, 'https://example.org/credits/Éva');
		assert.deepEqual(inspection.attachments, []);
	}
});
test('an external performer-information locator stays raw rather than becoming a literal performer', async () => {
	const inspection = await inspectImportedMediaMetadata(await createReferenceWavPackFixture(2, 'Artist'));
	assert.equal(inspection.metadata.raw?.ARTIST, 'https://example.org/credits/Éva');
	assert.equal(inspection.metadata.normalized?.artist, undefined);
	assert.deepEqual(inspection.attachments, []);
});

test('an external date reference cannot suppress an independent literal year', async () => {
	const file = await createReferenceWavPackFixture(2, 'Zate');
	const bytes = Buffer.from(await file.arrayBuffer());
	const year = bytes.lastIndexOf(Buffer.from('DATE\0')); assert.ok(year > 0);
	bytes.set(Buffer.from('YEAR'), year);
	const position = bytes.lastIndexOf(Buffer.from('ZATE\0')); assert.ok(position > 0);
	bytes.set(Buffer.from('DATE'), position);
	const inspection = await inspectImportedMediaMetadata(new File([Uint8Array.from(bytes).buffer], file.name));
	assert.equal(inspection.metadata.raw?.DATE, 'https://example.org/credits/Éva');
	assert.equal(inspection.metadata.normalized?.date, '2026');
});
