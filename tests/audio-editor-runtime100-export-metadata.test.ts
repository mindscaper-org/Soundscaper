/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { createDawprojectExport } from '../src/common/editor/dawproject-export.ts';
import { visits } from './helpers/runtime50-editing-metrics.ts';

test('R07 DAWproject metadata prepares only requested folded tag names in one traversal', context => {
	const tags = Object.fromEntries(Array.from({ length: 1000 }, (_, index) => [`custom-${index}`, `value-${index}`]));
	Object.assign(tags, { Producer: 'First producer', PRODUCER: 'Later producer', COMPOSER: 'Composer' });
	const captured: ReturnType<typeof createDawprojectExport>[] = [];
	const count = visits('find', () => { captured.push(createDawprojectExport({ project: { sampleRate: 48_000, tracks: [], clips: [], sources: [], metadata: { tags } } })); });
	const result = captured[0]!;
	const digest = createHash('sha256').update(result.metadataXml).digest('hex');
	context.diagnostic(`R07 tag find visits: ${count}; metadata digest: ${digest}`);
	assert.equal(digest, 'eeb1f544744279500a7d3ed080ab501cb717c83633fbae7f1c8e64684401ea85');
	assert.ok(count < 100, `metadata repeated ${count} tag comparisons`);
	assert.match(result.metadataXml, /<Producer>First producer<\/Producer>/u);
	assert.match(result.metadataXml, /<Composer>Composer<\/Composer>/u);
});

test('R07 exact metadata keys retain precedence over earlier case-insensitive aliases', () => {
	const result = createDawprojectExport({ project: { sampleRate: 48_000, tracks: [], clips: [], sources: [],
		metadata: { tags: { Producer: 'Earlier alias', producer: 'Exact value', WEBSITE: 'https://example.invalid/', __proto__: null } } } });
	assert.match(result.metadataXml, /<Producer>Exact value<\/Producer>/u);
	assert.match(result.metadataXml, /<Website>https:\/\/example.invalid\/<\/Website>/u);
});
