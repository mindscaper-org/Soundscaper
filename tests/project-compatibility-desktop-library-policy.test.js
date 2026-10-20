/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import test from 'node:test';

const policyUrl = new URL('../config/project-compatibility.json', import.meta.url);

test('desktop compatibility authority is split between two fresh family-v1 libraries', async () => {
	const policy = JSON.parse(await readFile(policyUrl, 'utf8'));
	const rule = policy.rules.find(({ id }) => id === 'current-desktop-project-catalog-commit');
	assert.ok(rule);
	assert.equal(rule.policyAuthority, 'family-v1-active');
	for (const path of rule.evidence) {
		await assert.doesNotReject(access(new URL(`../${path}`, import.meta.url)), path);
	}
});

test('desktop lease policy records exact package workflows without a release verdict', async () => {
	const policy = JSON.parse(await readFile(policyUrl, 'utf8'));
	const rule = policy.rules.find(({ id }) => id === 'current-desktop-electron-lease-protections');
	assert.ok(rule);
	assert.equal(rule.status, 'implemented');
	assert.equal(rule.policyAuthority, 'family-v1-active');
});

test('pre-freeze packaged shared-library handoff remains provenance only', async () => {
	const policy = JSON.parse(await readFile(policyUrl, 'utf8'));
	const rule = policy.rules.find(({ id }) => id === 'current-desktop-packaged-source-bearing-handoff');
	assert.ok(rule);
	assert.equal(rule.policyAuthority, 'historical-provenance-only');
	assert.equal(
		rule.historicalPreFreezeNarrative?.status,
		'provenance-only-not-runtime-authority',
	);
});
