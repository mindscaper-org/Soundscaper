/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { ACCEPTED_PROJECT_FILE_EXTENSIONS } from '../src/common/project-file-extensions.ts';

const policyUrl = new URL('../config/project-compatibility.json', import.meta.url);

test('the compatibility register names every accepted project suffix', async () => {
	const policy = JSON.parse(await readFile(policyUrl, 'utf8'));
	const rule = policy.rules.find(({ id }) => id === 'current-product-native-project-file-suffix');
	assert.ok(rule, 'the product-native suffix rule must exist');
	assert.equal(rule.status, 'implemented');
	for (const extension of ACCEPTED_PROJECT_FILE_EXTENSIONS) {
		assert.ok(rule.currentBehavior.includes(extension), extension);
	}
});
