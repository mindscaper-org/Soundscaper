/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { parseModulePolicy } from '../scripts/lib/module-policy.ts';
import { buildModuleTestSuites, modulePolicyWithTestSuites, partitionModuleTestSuites } from '../scripts/lib/module-test-suites.ts';
import { planModuleTests } from '../scripts/lib/module-test-plan.ts';

const policy = parseModulePolicy({ schemaVersion: 1, modules: [
	{ id: 'foundation', sourcePrefixes: ['src/common/foundation/'], nodeTests: [], independent: true },
	{ id: 'media', sourcePrefixes: ['src/common/media/'], nodeTests: [], independent: true },
	{ id: 'tooling', sourcePrefixes: ['scripts/'], nodeTests: [] },
] });
const snapshot = new Map([
	['src/common/foundation/abort.ts', 'export const abort = 1;'],
	['src/common/media/bytes.ts', "import '../foundation/abort.ts'; export const bytes = 1;"],
	['scripts/stage.ts', 'export const stage = 1;'],
	['tests/helpers/stage.ts', "export { stage } from '../../scripts/stage.ts';"],
	['tests/helpers/cycle.ts', "import './other.ts'; export { abort } from '../../src/common/foundation/abort.ts';"],
	['tests/helpers/other.ts', "import './cycle.ts';"],
	['tests/abort.test.ts', "import './helpers/cycle.ts';"],
	['tests/media.test.ts', "import '../src/common/media/bytes.ts';"],
	['tests/integration.test.ts', "import '../src/common/media/bytes.ts'; import '../src/common/foundation/abort.ts';"],
	['tests/stage.test.ts', "import './helpers/stage.ts';"],
	['tests/unknown.test.ts', ''],
]);
const nodeTests = [...snapshot.keys()].filter(file => file.endsWith('.test.ts'));
const inventory = () => buildModuleTestSuites({ policy, snapshot, nodeTests, browserTests: [] });

test('module suites follow test helpers and stop at the production module boundary', () => {
	const suites = inventory();
	assert.deepEqual(suites.find(suite => suite.id === 'unit/foundation')?.files, ['tests/abort.test.ts']);
	assert.deepEqual(suites.find(suite => suite.id === 'unit/media')?.files, ['tests/media.test.ts']);
	assert.deepEqual(suites.find(suite => suite.id === 'unit/tooling')?.files, ['tests/stage.test.ts']);
	assert.deepEqual(suites.find(suite => suite.id === 'unit/foundation')?.fixtures, ['tests/helpers/cycle.ts', 'tests/helpers/other.ts']);
});

test('cross-module and repository tests have explicit integration suites without disappearing', () => {
	const suites = inventory();
	assert.deepEqual(suites.find(suite => suite.id === 'integration/foundation+media')?.files, ['tests/integration.test.ts']);
	assert.deepEqual(suites.find(suite => suite.id === 'integration/repository')?.files, ['tests/unknown.test.ts']);
	assert.deepEqual(suites.flatMap(suite => suite.files).sort(), nodeTests.sort());
	const resolved = modulePolicyWithTestSuites(policy, suites);
	assert.ok(resolved.modules.find(module => module.id === 'foundation')?.nodeTests.includes('tests/integration.test.ts'));
	assert.ok(resolved.modules.find(module => module.id === 'tooling')?.nodeTests.includes('tests/stage.test.ts'));
});

test('source-inspection tests retain ownership when a path is passed to a filesystem API', () => {
	const sources = new Map(snapshot);
	const file = 'tests/source-security.test.ts';
	sources.set(file, "const path = join(root, 'src/common/media/bytes.ts'); readFileSync(path);");
	const suites = buildModuleTestSuites({ policy, snapshot: sources, nodeTests: [file], browserTests: [] });
	assert.deepEqual(suites[0]?.modules, ['media']);
	sources.set(file, "readFileSync('src/../outside'); readFileSync('../../../../src/outside');");
	assert.doesNotThrow(() => buildModuleTestSuites({ policy, snapshot: sources, nodeTests: [file], browserTests: [] }));
});

test('browser ownership uses the narrow declared workflow and records infrastructure as fixtures', () => {
	const browser = 'tests/browser/images.spec.js';
	const sources = new Map(snapshot);
	sources.set(browser, "import './audio-editor-test-fixtures.js';");
	sources.set('tests/browser/audio-editor-test-fixtures.js', "import '../../src/common/foundation/abort.ts';");
	const browserPolicy = parseModulePolicy({ ...policy, browserTests: [
		{ files: ['tests/browser/*.spec.js'], modules: ['tooling'], products: [] },
		{ files: [browser], modules: ['media'], products: [] },
	] });
	const suites = buildModuleTestSuites({ policy: browserPolicy, snapshot: sources, nodeTests: [], browserTests: [browser] });
	assert.deepEqual(suites[0]?.modules, ['media']);
	assert.equal(suites[0]?.kind, 'integration');
	assert.ok(suites[0]?.fixtures.includes('tests/browser/audio-editor-test-fixtures.js'));
});

test('affected module changes retain browser consumers of dependent owners and their products', () => {
	const browser = 'tests/browser/media.spec.js';
	const sources = new Map(snapshot);
	sources.set(browser, '');
	const dependentPolicy = parseModulePolicy({ ...policy,
		modules: policy.modules.map(module => module.id === 'media' ? { ...module, dependencies: ['foundation'], products: ['framescaper'] } : module),
		browserTests: [{ files: [browser], modules: ['media'], products: ['framescaper'] }],
	});
	const suites = buildModuleTestSuites({ policy: dependentPolicy, snapshot: sources, nodeTests, browserTests: [browser] });
	const selected = planModuleTests({ policy: modulePolicyWithTestSuites(dependentPolicy, suites), current: sources,
		nodeTests, browserTests: [browser], changedPaths: ['src/common/foundation/abort.ts'] });
	assert.equal(selected.mode, 'focused');
	assert.deepEqual(selected.browserTests, [browser]);
	assert.deepEqual(selected.products, ['framescaper']);
});

test('balanced execution partitions whole suite batches exactly once and deterministically', () => {
	const suites = inventory();
	const slots = ['one', 'two', 'three', 'four'];
	const partition = partitionModuleTestSuites(suites, slots);
	assert.deepEqual([...partition.values()].flat().sort(), nodeTests.sort());
	assert.deepEqual(partition, partitionModuleTestSuites([...suites].reverse(), slots));
	const weights = Object.assign({}, ...suites.map(suite => suite.weights)) as Record<string, number>;
	const loads = [...partition.values()].map(files => files.reduce((sum, file) => sum + weights[file]!, 0));
	assert.ok(Math.max(...loads) - Math.min(...loads) <= Math.max(...Object.values(weights)));
	assert.throws(() => partitionModuleTestSuites(suites, []), /slot/iu);
	assert.throws(() => partitionModuleTestSuites(suites, ['one', 'one']), /slot/iu);
	assert.throws(() => buildModuleTestSuites({ policy, snapshot, nodeTests: [...nodeTests, nodeTests[0]!], browserTests: [] }), /duplicate/iu);
});
