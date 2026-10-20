/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../', import.meta.url);

test('pre-freeze handoff evidence is provenance and cannot authorize family-v1 storage', async () => {
	const [closure, compatibility] = await Promise.all([
		json('config/milestone-2-closure.json'),
		json('config/project-compatibility.json'),
	]);
	const handoff = closure.items.find(({ id }) => id === 'm2-handoff-packaged-roundtrip');
	assert.equal(handoff.compatibilityBoundary.classification, 'legacy-shared-schema-17-pre-framescaper-v18');
	assert.equal(handoff.compatibilityBoundary.authorizesFramescaperV17Activation, false);
	assert.deepEqual(compatibility.historicalPreReleaseLineage.retainedMigrationSources, []);
	const isolation = compatibility.rules.find(({ id }) => id === 'family-v1-product-isolation');
	assert.equal(isolation.historicalPreFreezeNarrative.formerId, 'framescaper-v18-product-isolation');
	assert.equal(isolation.historicalPreFreezeNarrative.status, 'provenance-only-not-runtime-authority');
});

async function json(path) {
	return JSON.parse(await text(path));
}

async function text(path) {
	return readFile(new URL(path, root), 'utf8');
}
