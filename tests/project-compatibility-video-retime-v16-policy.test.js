/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import test from 'node:test';

const policyUrl = new URL('../config/project-compatibility.json', import.meta.url);

test('Framescaper v1 owns retime while embedded wire versions remain independent contracts', async () => {
	const policy = JSON.parse(await readFile(policyUrl, 'utf8'));
	const rule = policy.rules.find(({ id }) => id === 'current-video-retime-baseline');
	assert.ok(rule);
	assert.equal(rule.status, 'implemented');
	for (const reference of rule.evidence) {
		await assert.doesNotReject(access(new URL(`../${reference}`, import.meta.url)), reference);
	}
	assert.equal(rule.historicalPreFreezeNarrative.status, 'provenance-only-not-runtime-authority');
	assert.equal(rule.historicalPreFreezeNarrative.formerId, 'current-video-retime-v16-preservation');
});
