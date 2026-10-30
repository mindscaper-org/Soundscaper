/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { parseModulePolicy, ownerOfModulePath, matchesModulePattern, type ModulePolicy } from '../scripts/lib/module-policy.ts';
import { buildModuleGraph } from '../scripts/lib/module-dependency-graph.ts';
import { planModuleTests } from '../scripts/lib/module-test-plan.ts';

const policy = parseModulePolicy({
	schemaVersion: 1,
	globalInputs: ['package-lock.json', 'tsconfig*.json'],
	modules: [
		{ id: 'imaging', sourcePrefixes: ['src/common/imaging/'], dependencies: ['media'], nodeTests: ['tests/pixels.test.ts', 'tests/masks.test.ts'], products: ['framescaper'], independent: true },
		{ id: 'media', sourcePrefixes: ['src/common/media/'], nodeTests: ['tests/bytes.test.ts'], products: [], independent: true },
		{ id: 'timeline', sourcePrefixes: ['src/common/editor/'], nodeTests: ['tests/audio.test.ts', 'tests/render.test.ts'], products: ['soundscaper', 'framescaper'], independent: false },
		{ id: 'framescaper', sourcePrefixes: ['src/framescaper/'], nodeTests: [], products: ['framescaper'], independent: false },
	],
	browserTests: [{ files: ['tests/browser/images.spec.js'], modules: ['imaging'], products: ['framescaper'] }],
	runtimeInputs: [{ files: ['src/common/imaging/pixels.ts'], dependencies: ['fixtures/lookup.bin'] }],
});
const sources = new Map([
	['src/common/imaging/pixels.ts', "import { read } from '../media/bytes.ts'; export const render = read;"],
	['src/common/imaging/masks.ts', 'export const mask = 1;'],
	['src/common/media/bytes.ts', 'export const read = 1;'],
	['src/common/editor/audio.ts', 'export const play = 1;'],
	['src/common/editor/render.ts', "export { render } from '../imaging/pixels.ts';"],
	['tests/helpers/image.ts', "export { render } from '../../src/common/editor/render.ts';"],
	['tests/pixels.test.ts', "import '../src/common/imaging/pixels.ts';"],
	['tests/masks.test.ts', "import '../src/common/imaging/masks.ts';"],
	['tests/bytes.test.ts', "import '../src/common/media/bytes.ts';"],
	['tests/render.test.ts', "import './helpers/image.ts';"],
	['tests/audio.test.ts', "import '../src/common/editor/audio.ts';"],
	['tests/browser/images.spec.js', ''],
	['tests/browser/audio.spec.js', ''],
	['fixtures/lookup.bin', 'binary fixture'],
]);
const nodeTests = [...sources.keys()].filter(file => file.endsWith('.test.ts'));
const browserTests = [...sources.keys()].filter(file => file.endsWith('.spec.js'));
const plan = (changedPaths: string[], extra: Partial<Parameters<typeof planModuleTests>[0]> = {}) => planModuleTests({
	policy, current: sources, changedPaths, nodeTests, browserTests, ...extra,
});

test('imaging changes select the full owner suite, actual consumers and visual browsers without audio', () => {
	const selected = plan(['src/common/imaging/pixels.ts']);
	assert.equal(selected.mode, 'focused');
	assert.deepEqual(selected.modules, ['imaging']);
	assert.deepEqual(selected.nodeTests, ['tests/masks.test.ts', 'tests/pixels.test.ts', 'tests/render.test.ts']);
	assert.deepEqual(selected.browserTests, ['tests/browser/images.spec.js']);
	assert.deepEqual(selected.products, ['framescaper']);
});

test('shared byte changes reach imaging consumers without selecting unrelated audio', () => {
	const selected = plan(['src/common/media/bytes.ts']);
	assert.equal(selected.mode, 'focused');
	assert.deepEqual(selected.nodeTests, ['tests/bytes.test.ts', 'tests/pixels.test.ts', 'tests/render.test.ts']);
	assert.deepEqual(selected.browserTests, ['tests/browser/images.spec.js']);
});

test('deleted and renamed dependencies are selected through the base graph', () => {
	const current = new Map(sources);
	current.delete('src/common/imaging/pixels.ts');
	current.set('src/common/imaging/renamed.ts', 'export const render = 2;');
	current.set('src/common/editor/render.ts', "export { render } from '../imaging/renamed.ts';");
	current.set('tests/pixels.test.ts', "import '../src/common/imaging/renamed.ts';");
	const selected = plan(['src/common/imaging/pixels.ts', 'src/common/imaging/renamed.ts'], { current, base: sources });
	assert.equal(selected.mode, 'focused');
	assert.ok(selected.nodeTests.includes('tests/render.test.ts'));
	assert.ok(selected.nodeTests.includes('tests/pixels.test.ts'));
});

test('declared binary inputs select the module and preserve downstream coverage', () => {
	const selected = plan(['fixtures/lookup.bin']);
	assert.equal(selected.mode, 'full');
	assert.ok(selected.modules.includes('timeline'));
	assert.ok(selected.nodeTests.includes('tests/masks.test.ts'));
	assert.ok(selected.nodeTests.includes('tests/render.test.ts'));
});

test('type imports, literal dynamic imports and worker URLs retain dependency edges', () => {
	const snapshot = new Map([
		['src/type.ts', 'export interface Result {}'],
		['src/runtime.ts', 'export const run = 1'],
		['src/worker.ts', 'postMessage(1)'],
		['src/start.ts', "import type { Result } from './type.js'; type Loaded = import('./runtime.ts').run; new Worker(new URL('./worker.ts', import.meta.url));"],
	]);
	assert.deepEqual([...buildModuleGraph(snapshot).dependencies.get('src/start.ts') ?? []].sort(), ['src/runtime.ts', 'src/type.ts', 'src/worker.ts']);
});

test('literal dynamic imports, glob imports and assets resolve while computed worker entrypoints stay unresolved', () => {
	const snapshot = new Map([
		['src/plugin.ts', 'export const run = 1'],
		['src/lookup.bin', 'binary'],
		['src/start.ts', "const load = () => import('./plugin.ts'); import.meta.glob('./*.ts'); new URL('./lookup.bin', import.meta.url); new Worker(entrypoint);"],
	]);
	const graph = buildModuleGraph(snapshot);
	assert.ok(graph.dependencies.get('src/start.ts')?.has('src/plugin.ts'));
	assert.ok(graph.dependencies.get('src/start.ts')?.has('src/lookup.bin'));
	assert.match(graph.unresolved.get('src/start.ts')?.join('\n') ?? '', /computed/iu);
});

test('versioned extensionless imports resolve and directory URL locations do not invent source reads', () => {
	const snapshot = new Map([
		['src/tokens.v2.ts', 'export interface Tokens {}'],
		['src/themes/dark.ts', "import type { Tokens } from '../tokens.v2'; new URL('.', import.meta.url); new URL('..', import.meta.url);"],
	]);
	const graph = buildModuleGraph(snapshot);
	assert.deepEqual([...graph.dependencies.get('src/themes/dark.ts') ?? []], ['src/tokens.v2.ts']);
	assert.equal(graph.unresolved.has('src/themes/dark.ts'), false);
});

test('product substitution resolves the actual consumer instead of the default implementation', () => {
	const snapshot = new Map([
		['src/default.ts', 'export const run = 1'],
		['src/disabled.ts', 'export const run = 0'],
		['src/entry.ts', "import './default.ts'"],
	]);
	const graph = buildModuleGraph(snapshot, { resolveSpecifier: (specifier, importer) => importer === 'src/entry.ts' && specifier === './default.ts' ? 'src/disabled.ts' : null });
	assert.deepEqual([...graph.dependencies.get('src/entry.ts') ?? []], ['src/disabled.ts']);
});

test('affected planning honors product substitutions when selecting downstream Node consumers', () => {
	const snapshot = new Map([
		['src/common/imaging/pixels.ts', 'export const render = 1;'],
		['src/framescaper/disabled.ts', 'export const render = 0;'],
		['src/framescaper/entry.ts', "import '../common/imaging/pixels.ts';"],
		['tests/pixels.test.ts', "import '../src/common/imaging/pixels.ts';"],
		['tests/product.test.ts', "import '../src/framescaper/entry.ts';"],
	]);
	const options = { policy, current: snapshot, changedPaths: ['src/common/imaging/pixels.ts'],
		nodeTests: ['tests/pixels.test.ts', 'tests/product.test.ts'], browserTests: [] };
	assert.deepEqual(planModuleTests(options).nodeTests, ['tests/pixels.test.ts', 'tests/product.test.ts']);
	const selected = planModuleTests({ ...options,
		resolveSpecifier: (specifier, importer) => importer === 'src/framescaper/entry.ts' && specifier === '../common/imaging/pixels.ts' ? 'src/framescaper/disabled.ts' : null,
	});
	assert.equal(selected.mode, 'focused');
	assert.deepEqual(selected.nodeTests, ['tests/pixels.test.ts']);
});

test('computed imports in an affected closure select full checks but unrelated unknown code does not', () => {
	const current = new Map(sources);
	current.set('src/common/editor/audio.ts', 'export const play = () => import(name);');
	current.set('src/framescaper/bootstrap.ts', "import '../common/editor/render.ts'; import '../common/editor/audio.ts';");
	assert.equal(plan(['src/common/imaging/pixels.ts'], { current }).mode, 'focused');
	current.set('src/common/imaging/pixels.ts', 'export const render = () => import(name);');
	const selected = plan(['src/common/imaging/pixels.ts'], { current });
	assert.equal(selected.mode, 'full');
	assert.match(selected.reasons.join('\n'), /unresolved|computed/iu);
	assert.deepEqual(selected.nodeTests, [...nodeTests].sort());
});

test('unknown changes and global inputs conservatively retain all tests', () => {
	for (const changed of ['unknown.config', 'package-lock.json', 'tsconfig.tests.json']) {
		const selected = plan([changed]);
		assert.equal(selected.mode, 'full');
		assert.deepEqual(selected.nodeTests, [...nodeTests].sort());
	}
});

test('non-independent changed modules keep the broad gate while explicit local modules remain focused', () => {
	assert.equal(plan(['src/common/editor/audio.ts']).mode, 'full');
	const selected = plan([], { modules: ['timeline'] });
	assert.equal(selected.mode, 'focused');
	assert.deepEqual(selected.nodeTests, ['tests/audio.test.ts', 'tests/render.test.ts']);
});

test('explicit modules run their declared target without unrelated consumer or bootstrap work', () => {
	const current = new Map(sources);
	current.set('src/framescaper/bootstrap.ts', "import '../common/editor/render.ts'; import(name);");
	current.set('tests/bootstrap.test.ts', "import '../src/framescaper/bootstrap.ts';");
	const overlappingPolicy = parseModulePolicy({ ...policy, browserTests: [...policy.browserTests!, {
		files: ['tests/browser/*.spec.js'], modules: ['timeline'], products: ['soundscaper'],
	}] });
	const selected = plan([], { policy: overlappingPolicy, current, modules: ['imaging'], nodeTests: [...nodeTests, 'tests/bootstrap.test.ts'] });
	assert.equal(selected.mode, 'focused');
	assert.deepEqual(selected.nodeTests, ['tests/masks.test.ts', 'tests/pixels.test.ts']);
	assert.deepEqual(selected.browserTests, ['tests/browser/images.spec.js']);
	assert.deepEqual(selected.products, ['framescaper']);
});

test('visual changes do not select every browser target owned by a reverse production consumer', () => {
	const expanded = parseModulePolicy({ ...policy, browserTests: [...policy.browserTests!, {
		files: ['tests/browser/audio.spec.js'], modules: ['timeline'], products: ['soundscaper'],
	}] });
	const selected = plan(['src/common/imaging/pixels.ts'], { policy: expanded });
	assert.deepEqual(selected.browserTests, ['tests/browser/images.spec.js']);
	assert.ok(selected.nodeTests.includes('tests/render.test.ts'));
});

test('unclassified new tests and legacy helper consumers retain full coverage gates', () => {
	const current = new Map(sources);
	current.set('tests/new-image.test.ts', "import '../src/common/imaging/pixels.ts';");
	const selected = plan(['tests/new-image.test.ts'], { current, nodeTests: [...nodeTests, 'tests/new-image.test.ts'] });
	assert.equal(selected.mode, 'full');
	assert.ok(selected.reasons.some(reason => /no declared.*owner/iu.test(reason)));
	const helper = plan(['tests/helpers/image.ts']);
	assert.equal(helper.mode, 'full');
	assert.deepEqual(helper.modules, ['timeline']);
});

test('removing a declared test body or production import still gates its complete owned source coverage', () => {
	const current = new Map(sources);
	current.set('tests/pixels.test.ts', '');
	const selected = plan(['tests/pixels.test.ts'], { current, base: sources });
	assert.equal(selected.mode, 'focused');
	assert.deepEqual(selected.modules, ['imaging']);
	assert.deepEqual(selected.nodeTests, ['tests/masks.test.ts', 'tests/pixels.test.ts']);
});

test('reducing a browser workflow infers all declared module memberships', () => {
	const current = new Map(sources);
	current.set('tests/browser/images.spec.js', '');
	const selected = plan(['tests/browser/images.spec.js'], { current, base: sources });
	assert.equal(selected.mode, 'focused');
	assert.deepEqual(selected.modules, ['imaging']);
	assert.deepEqual(selected.nodeTests, ['tests/masks.test.ts', 'tests/pixels.test.ts']);
	const overlapping = parseModulePolicy({ ...policy, browserTests: [...policy.browserTests!, {
		files: ['tests/browser/*.spec.js'], modules: ['timeline'], products: ['soundscaper'],
	}] });
	const broad = plan(['tests/browser/images.spec.js'], { policy: overlapping, current, base: sources });
	assert.equal(broad.mode, 'full');
	assert.deepEqual(broad.modules, ['imaging', 'timeline']);
});

test('overlapping legacy Node membership cannot bypass the full coverage union', () => {
	const overlapping = parseModulePolicy({ ...policy, modules: policy.modules.map(module => module.id === 'timeline'
		? { ...module, nodeTests: ['tests/*.test.ts'] } : module) });
	const selected = plan(['tests/pixels.test.ts'], { policy: overlapping });
	assert.equal(selected.mode, 'full');
	assert.deepEqual(selected.modules, ['imaging', 'timeline']);
});

test('deleted helpers retain the coverage owners of consumers that lost their imports in the base graph', () => {
	const base = new Map(sources);
	base.set('tests/helpers/pixel-fixture.ts', "import '../../src/common/imaging/pixels.ts';");
	base.set('tests/pixels.test.ts', "import './helpers/pixel-fixture.ts';");
	const current = new Map(base);
	current.delete('tests/helpers/pixel-fixture.ts');
	current.set('tests/pixels.test.ts', '');
	const selected = plan(['tests/helpers/pixel-fixture.ts'], { current, base });
	assert.equal(selected.mode, 'focused');
	assert.deepEqual(selected.modules, ['imaging']);
	assert.deepEqual(selected.nodeTests, ['tests/masks.test.ts', 'tests/pixels.test.ts']);
});

test('deleting an owned test preserves its module denominator and selects remaining owner tests', () => {
	const current = new Map(sources);
	current.delete('tests/pixels.test.ts');
	const selected = plan(['tests/pixels.test.ts'], { current, base: sources,
		nodeTests: nodeTests.filter(file => file !== 'tests/pixels.test.ts') });
	assert.equal(selected.mode, 'focused');
	assert.deepEqual(selected.modules, ['imaging']);
	assert.deepEqual(selected.nodeTests, ['tests/masks.test.ts']);
});

test('policy validates dependencies, paths and ambiguity instead of silently assigning common', () => {
	assert.equal(matchesModulePattern('config/pins/runtime.json', 'config/**/*.json'), true);
	assert.equal(matchesModulePattern('config/runtime.json', 'config/**/*.json'), true);
	assert.equal(matchesModulePattern('config/runtime.js', 'config/**/*.json'), false);
	assert.throws(() => parseModulePolicy({ schemaVersion: 1, modules: [{ id: 'x', sourcePrefixes: ['../outside'], nodeTests: [], products: [] }] }), /relative/iu);
	assert.throws(() => parseModulePolicy({ schemaVersion: 1, modules: [{ id: 'x', sourcePrefixes: ['src/'], nodeTests: [], products: [], dependencies: ['missing'] }] }), /unknown module/iu);
	const ambiguous: ModulePolicy = { ...policy, modules: [...policy.modules, { ...policy.modules[0]!, id: 'duplicate' }] };
	assert.throws(() => ownerOfModulePath(ambiguous, 'src/common/imaging/pixels.ts'), /ambiguous/iu);
});
