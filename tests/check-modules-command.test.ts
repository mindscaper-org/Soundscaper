/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { parseModuleCommandArguments } from '../scripts/check-modules.ts';

test('module check commands separate read-only plans from execution and accept pinned bases', () => {
	assert.deepEqual(parseModuleCommandArguments(['--module', 'imaging', '--list'], '/repo'), {
		root: '/repo', modules: ['imaging'], list: true, json: false, ci: false,
	});
	assert.deepEqual(parseModuleCommandArguments(['--base=abc123', '--json', '--ci', '--output=.wrangler/plan.json'], '/repo'), {
		root: '/repo', base: 'abc123', list: false, json: true, ci: true, output: '.wrangler/plan.json',
	});
	assert.throws(() => parseModuleCommandArguments(['--base'], '/repo'), /Missing/u);
	assert.throws(() => parseModuleCommandArguments(['--module', 'imaging', '--base=HEAD'], '/repo'), /not both/u);
	assert.throws(() => parseModuleCommandArguments(['--unknown'], '/repo'), /Unknown/u);
});
