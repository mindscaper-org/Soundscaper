/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import test from 'node:test';
import { repositoryModuleTestSuites } from '../scripts/lib/module-test-inventory.ts';
import { parseModuleNodeSelection } from '../scripts/lib/module-test-selection.ts';
import { browserSuiteFiles, browserSuiteTestMatch, parseBrowserSuiteShard } from '../scripts/lib/module-browser-suites.ts';
import { partitionModuleTestSuites } from '../scripts/lib/module-test-suites.ts';
import { listNodeTestFiles, NODE_TEST_SHARD_IDS } from '../scripts/lib/node-test-shards.mjs';

test('the repository inventory and scheduled union retain every Node test and fixture consumer', () => {
	const root = resolve(import.meta.dirname, '..');
	const suites = repositoryModuleTestSuites(root);
	const node = suites.filter(suite => suite.runtime === 'node');
	assert.deepEqual(node.flatMap(suite => suite.files.map(file => resolve(root, file))).sort(), listNodeTestFiles(root));
	const slots = partitionModuleTestSuites(node, NODE_TEST_SHARD_IDS);
	assert.deepEqual([...slots.values()].flat().sort(), node.flatMap(suite => suite.files).sort());
	for (const id of ['foundation', 'imaging', 'media', 'scape', 'platform', 'tooling', 'handbook']) {
		assert.ok(node.some(suite => suite.modules.includes(id)), `${id} must have an owner suite`);
	}
	for (const file of ['tests/desktop-nightly-tests-staging.test.js', 'tests/desktop-nightly-tests-staging-refusals.test.js', 'tests/desktop-nightly-interchange.test.ts']) {
		assert.ok(node.some(suite => suite.modules.includes('tooling') && suite.files.includes(file)
			&& suite.fixtures.includes('tests/helpers/nightly-tests-staging-fixture.js')), file);
	}
	const browser = suites.filter(suite => suite.runtime === 'browser');
	const files = browser.flatMap(suite => suite.files);
	const browserSlots = Array.from({ length: 4 }, (_, index) => browserSuiteFiles(root, suites, files, index + 1, 4));
	assert.deepEqual(browserSlots.flat().sort(), files.sort());
	assert.equal(new Set(browserSlots.flat()).size, files.length);
});

test('module selectors retain legacy arguments and reject ambiguous or empty selections', () => {
	const selection = parseModuleNodeSelection(['--module=media,scape', '--suite=unit/media', '--module-shard=common-1', '--json', '--shard=framescaper'], NODE_TEST_SHARD_IDS);
	assert.deepEqual(selection.modules, ['media', 'scape']);
	assert.deepEqual(selection.suites, ['unit/media']);
	assert.deepEqual(selection.remaining, ['--shard=framescaper']);
	assert.equal(selection.list, true);
	assert.throws(() => parseModuleNodeSelection(['--module='], NODE_TEST_SHARD_IDS), /nonempty/u);
	assert.throws(() => parseModuleNodeSelection(['--module-shard=unknown'], NODE_TEST_SHARD_IDS), /Unknown/u);
	assert.throws(() => parseModuleNodeSelection(['--module-shard=common-1', '--module-shard=common-2'], NODE_TEST_SHARD_IDS), /one/u);
});

test('browser suite selection rejects foreign paths and cannot widen a focused plan', () => {
	assert.deepEqual(parseBrowserSuiteShard(['--suite-shard=2/4', '--project=chromium']), { index: 2, total: 4, args: ['--project=chromium'] });
	for (const args of [['--suite-shard=0/4'], ['--suite-shard=2/1'], ['--suite-shard=1/4', '--shard=1/4']]) {
		assert.throws(() => parseBrowserSuiteShard(args), /suite shard/u);
	}
	const file = 'tests/browser/example.spec.js';
	assert.deepEqual(browserSuiteTestMatch('/repo', JSON.stringify([file]), [file]), [`/repo/${file}`]);
	assert.throws(() => browserSuiteTestMatch('/repo', JSON.stringify(['tests/browser/../foreign.spec.js'])), /invalid/u);
	assert.throws(() => browserSuiteTestMatch('/repo', JSON.stringify([file]), []), /invalid/u);
	assert.throws(() => browserSuiteFiles('/repo', [], [file], 1, 4), /no execution suite/u);
});
