/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { ownerOfModulePath, parseModulePolicy } from '../scripts/lib/module-policy.ts';
import { planModuleTests } from '../scripts/lib/module-test-plan.ts';

void test('the Motion module owns its product code and selects ordinary workflows with all required origins', () => {
	const policy = parseModulePolicy(JSON.parse(readFileSync(new URL('../config/module-policy.json', import.meta.url), 'utf8')));
	for (const file of ['src/motionscaper/editor-scape.ts', 'desktop/motionscaper-file-authority.ts', 'native/motionscaper-media-host/main.cpp']) {
		assert.equal(ownerOfModulePath(policy, file)?.id, 'motionscaper');
	}
	const nodeTest = 'tests/motionscaper-opaque-archive.test.ts';
	const browserTest = 'tests/browser/motionscaper-opaque-archive.spec.ts';
	const linkedTest = 'tests/browser/motionscaper-linked-editors.spec.ts';
	const plan = planModuleTests({ policy, current: new Map(), changedPaths: [], modules: ['motionscaper'],
		nodeTests: [nodeTest], browserTests: [browserTest, linkedTest] });
	assert.deepEqual(plan.nodeTests, [nodeTest]);
	assert.deepEqual(plan.browserTests, [browserTest]);
	assert.deepEqual(plan.products, ['framescaper', 'motionscaper', 'soundscaper']);
});
