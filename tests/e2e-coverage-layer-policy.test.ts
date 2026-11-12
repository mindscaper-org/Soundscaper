/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';

import {
	digestCoverageTestLayers,
	parseCoverageTestLayers,
	resolveCoverageTestLayers,
	validateCoverageTestLayerFiles,
} from '../scripts/lib/e2e-coverage-layer-policy.mjs';

const sourcePath = 'src/common/foundation/example.ts';
const sourceBytes = 'export function example(value: boolean): boolean { return !value; }\n';
const sourceHash = `sha256:${createHash('sha256').update(sourceBytes).digest('hex')}`;
const surface = 'browser-chromium-soundscaper-renderer';
type ResolvedSource = Readonly<{ path: string; layer: 'native' | 'node-deterministic' }>;

function fixture() {
	return {
		schemaVersion: 1,
		kind: 'soundscaper-coverage-test-layers',
		defaultLayer: 'native',
		thresholds: { lines: 100, statements: 100, functions: 100, branches: 100 },
		sources: [{
			path: sourcePath,
			layer: 'node-deterministic',
			sourceSha256: sourceHash,
			nodeTests: ['tests/example.test.ts'],
			nativeWitness: { spec: 'tests/browser/example.spec.js', title: 'imports and saves real media', surfaces: [surface] },
			reason: 'Pure boolean transformation; native chooser, storage and rendering retain actual integration witnesses.',
		}],
	};
}

function inventory() {
	return {
		sources: [
			{ path: sourcePath, origin: 'repository', sha256: sourceHash, surfaces: [surface] },
			{ path: 'src/editor/native-storage.ts', origin: 'repository', sha256: sourceHash, surfaces: [surface] },
			{ path: 'generated/opaque.js', origin: 'artifact', sha256: sourceHash, surfaces: [surface], artifactPath: 'scripts/opaque.js' },
		],
		scripts: [{ id: 'soundscaper/renderer.js', surface, sources: [sourcePath, 'src/editor/native-storage.ts', 'generated/opaque.js'] }],
	};
}

test('reviewed exact source ownership keeps the full inventory and every script, with native as the default', () => {
	const policy = parseCoverageTestLayers(fixture());
	const executableInventory = inventory();
	const resolution = resolveCoverageTestLayers({ policy, inventory: executableInventory });
	assert.equal(resolution.sources.length, 3);
	assert.deepEqual(resolution.sources.map((source: ResolvedSource) => [source.path, source.layer]), [
		[sourcePath, 'node-deterministic'], ['src/editor/native-storage.ts', 'native'], ['generated/opaque.js', 'native'],
	]);
	assert.equal(resolution.scripts, executableInventory.scripts);
	assert.equal(resolution.nodeSources[0], resolution.sources[0]);
	assert.equal(resolution.nativeSources.length, 2);
	assert.equal(resolution.policyDigest, digestCoverageTestLayers(policy));
	assert.equal(Object.isFrozen(policy.sources[0]?.nativeWitness.surfaces), true);
	assert.equal(Object.isFrozen(resolution.sources), true);
	assert.deepEqual(executableInventory.sources, inventory().sources, 'resolution does not mutate authenticated inventory');

	const allNative = fixture(); allNative.sources = [];
	assert.equal(resolveCoverageTestLayers({ policy: allNative, inventory: executableInventory }).nodeSources.length, 0);
});

test('configuration identity binds the reason, exact Node entrypoints and reviewed native driver selectors', () => {
	const policy = fixture();
	const original = digestCoverageTestLayers(policy);
	const reorderedKeys = Object.fromEntries(Object.entries(policy).reverse());
	assert.equal(digestCoverageTestLayers(reorderedKeys), original);
	for (const alter of [
		(value: ReturnType<typeof fixture>) => { value.sources[0]!.reason += ' Reviewed change.'; },
		(value: ReturnType<typeof fixture>) => { value.sources[0]!.nodeTests = ['tests/another.test.ts']; },
		(value: ReturnType<typeof fixture>) => { value.sources[0]!.nativeWitness.title = 'another actual interaction'; },
	]) {
		const changed = fixture(); alter(changed);
		assert.notEqual(digestCoverageTestLayers(changed), original);
	}
});

test('policy cannot lower, round, omit or extend a literal 100% metric', () => {
	for (const metric of ['lines', 'statements', 'functions', 'branches'] as const) {
		const policy = fixture(); policy.thresholds[metric] = 99.999;
		assert.throws(() => parseCoverageTestLayers(policy), /exactly 100/u);
	}
	assert.throws(() => parseCoverageTestLayers({ ...fixture(), thresholds: { lines: 100, statements: 100, functions: 100 } }), /missing or unknown fields/u);
	assert.throws(() => parseCoverageTestLayers({ ...fixture(), defaultLayer: 'node-deterministic' }), /default coverage layer/u);
});

test('unknown fields and accessor-based policy records fail before eligibility can be interpreted', () => {
	const policy = fixture();
	for (const changed of [
		{ ...policy, sourcePrefixes: ['src/'] },
		{ ...policy, sources: [{ ...policy.sources[0], nativeFallback: true }] },
		{ ...policy, sources: [{ ...policy.sources[0], nativeWitness: { ...policy.sources[0]!.nativeWitness, rootCountsAreEnough: true } }] },
	]) assert.throws(() => parseCoverageTestLayers(changed), /missing or unknown fields/u);
	const getter = fixture();
	Object.defineProperty(getter.sources[0], 'path', { enumerable: true, get() { throw new Error('must not read getters'); } });
	assert.throws(() => parseCoverageTestLayers(getter), /data properties/u);
});

test('source policies reject prefixes, globs, traversal, generated files, declarations and test sources', () => {
	for (const path of [
		'src/', 'src/**/*.ts', '/src/example.ts', '../src/example.ts', 'src/../example.ts', 'src//example.ts',
		'src\\example.ts', 'src/./example.ts', 'generated/opaque.js', 'src/generated/example.ts',
		'src/model.generated.ts', 'src/model.test.ts', 'src/model.d.ts', 'tests/example.test.ts', 'src/__tests__/example.ts',
	]) {
		const policy = fixture(); policy.sources[0]!.path = path;
		assert.throws(() => parseCoverageTestLayers(policy), /exact safe production source/u, path);
	}
	const reviewedPureUiLeaf = fixture(); reviewedPureUiLeaf.sources[0]!.path = 'src/common/editor/ui/inspector/macro-run-target.ts';
	assert.doesNotThrow(() => parseCoverageTestLayers(reviewedPureUiLeaf), 'an exact reviewed pure UI leaf is allowed without admitting the UI directory');
});

test('source entries and Node test bindings must be unique and canonically sorted', () => {
	const duplicate = fixture(); duplicate.sources.push({ ...duplicate.sources[0]! });
	assert.throws(() => parseCoverageTestLayers(duplicate), /duplicates/u);
	const unordered = fixture(); unordered.sources.push({ ...unordered.sources[0]!, path: 'src/a.ts' });
	assert.throws(() => parseCoverageTestLayers(unordered), /sorted by code unit/u);
	for (const nodeTests of [[], ['tests/example.test.ts', 'tests/example.test.ts'], ['tests/z.test.ts', 'tests/a.test.ts'],
		['tests/browser/example.spec.js'], ['tests/helpers/example.test.ts'], ['tests/*.test.ts']]) {
		const policy = fixture(); policy.sources[0]!.nodeTests = nodeTests;
		assert.throws(() => parseCoverageTestLayers(policy), /test paths|entrypoint paths/u);
	}
});

test('native witness selectors need a real spec shape, exact title and configured surfaces', () => {
	for (const nativeWitness of [
		{ spec: 'tests/example.test.ts', title: 'imports media', surfaces: [surface] },
		{ spec: 'tests/browser/example.spec.js', title: ' ', surfaces: [surface] },
		{ spec: 'tests/browser/example.spec.js', title: 'imports\nmedia', surfaces: [surface] },
		{ spec: 'tests/browser/example.spec.js', title: 'imports media', surfaces: ['invented-runtime'] },
		{ spec: 'tests/browser/example.spec.js', title: 'imports media', surfaces: [surface, surface] },
	]) {
		const policy = fixture(); policy.sources[0]!.nativeWitness = nativeWitness;
		assert.throws(() => parseCoverageTestLayers(policy), /witness|native test title/u);
	}
});

test('unbuilt, artifact, stale or wrong-surface Node ownership fails without a native fallback', () => {
	const policy = fixture();
	const missing = inventory(); missing.sources.shift();
	assert.throws(() => resolveCoverageTestLayers({ policy, inventory: missing }), /absent from the executable inventory/u);
	const artifact = inventory(); artifact.sources[0]!.origin = 'artifact';
	assert.throws(() => resolveCoverageTestLayers({ policy, inventory: artifact }), /not a repository source/u);
	const stale = inventory(); stale.sources[0]!.sha256 = `sha256:${'0'.repeat(64)}`;
	assert.throws(() => resolveCoverageTestLayers({ policy, inventory: stale }), /changed since its eligibility review/u);
	const wrongSurface = inventory(); wrongSurface.sources[0]!.surfaces = ['browser-chromium-framescaper-renderer'];
	assert.throws(() => resolveCoverageTestLayers({ policy, inventory: wrongSurface }), /does not own the source/u);
});

test('filesystem qualification checks exact source bytes and actual declared test and witness files', t => {
	const root = mkdtempSync(join(tmpdir(), 'coverage-layer-policy-'));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	const policy = fixture();
	const files = new Map([[sourcePath, sourceBytes], ['tests/example.test.ts', ''], ['tests/browser/example.spec.js', '']]);
	for (const [path, bytes] of files) { const actual = join(root, path); mkdirSync(dirname(actual), { recursive: true }); writeFileSync(actual, bytes); }
	assert.doesNotThrow(() => validateCoverageTestLayerFiles(policy, { repositoryRoot: root }));
	writeFileSync(join(root, sourcePath), `${sourceBytes}// changed\n`);
	assert.throws(() => validateCoverageTestLayerFiles(policy, { repositoryRoot: root }), /source SHA-256/u);
	writeFileSync(join(root, sourcePath), sourceBytes);
	rmSync(join(root, 'tests/example.test.ts'));
	assert.throws(() => validateCoverageTestLayerFiles(policy, { repositoryRoot: root }), /ENOENT/u);
});

test('safe-looking policy paths cannot escape the checkout through a test symlink', t => {
	const root = mkdtempSync(join(tmpdir(), 'coverage-layer-policy-'));
	const outside = mkdtempSync(join(tmpdir(), 'coverage-layer-outside-'));
	t.after(() => { rmSync(root, { recursive: true, force: true }); rmSync(outside, { recursive: true, force: true }); });
	mkdirSync(join(root, dirname(sourcePath)), { recursive: true }); writeFileSync(join(root, sourcePath), sourceBytes);
	mkdirSync(join(root, 'tests'), { recursive: true }); writeFileSync(join(outside, 'external.test.ts'), '');
	symlinkSync(join(outside, 'external.test.ts'), join(root, 'tests/example.test.ts'));
	assert.throws(() => validateCoverageTestLayerFiles(fixture(), { repositoryRoot: root }), /escapes the repository/u);
});
