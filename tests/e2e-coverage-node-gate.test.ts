/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { prepareQualifiedNodeArtifacts, type QualifiedNodeProfile } from '../scripts/lib/qualified-node-artifacts.ts';
import { validateQualifiedNodeEvidence } from '../scripts/lib/e2e-coverage-node-gate.mjs';
import { sha256Digest } from '../scripts/lib/e2e-coverage-integrity.mjs';
import { validateE2ERawV8Topology } from '../scripts/lib/e2e-v8-topology.mjs';
import { runE2ECoverageGate } from '../scripts/lib/e2e-coverage-runner.mjs';
import { digestE2EInventory, formatE2ECoverageResult, parseE2ECoverageConfiguration } from '../scripts/lib/e2e-coverage-contract.mjs';
import { coverageFileRecords, e2eExecutableCoverageKey, stableSha256Digest } from '../scripts/lib/e2e-coverage-integrity.mjs';
import { copyQualifiedNodeEvidence } from '../scripts/lib/e2e-coverage-node-transport.mjs';
import { parseCoverageTestLayers } from '../scripts/lib/e2e-coverage-layer-policy.mjs';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sourcePath = 'src/common/foundation/example.ts';
const surface = 'browser-chromium-soundscaper-renderer';
const source = 'export function choose(value: boolean): number { return value ? 1 : 2; }\n';

function fixture(fixtureSource = source, testSource?: string) {
	const root = mkdtempSync(join(tmpdir(), 'e2e-node-gate-'));
	for (const directory of ['src/common/foundation', 'tests/browser']) mkdirSync(join(root, directory), { recursive: true });
	writeFileSync(join(root, sourcePath), fixtureSource);
	writeFileSync(join(root, 'tests/browser/example.spec.js'), '// The maintained native driver is selected separately.\n');
	writeFileSync(join(root, 'tests/example.test.ts'), testSource ?? `import assert from 'node:assert/strict';\nimport test from 'node:test';\nimport { choose } from '../${sourcePath}';\ntest('both outcomes', () => { assert.equal(choose(true), 1); assert.equal(choose(false), 2); });\n`);
	cpSync(join(repositoryRoot, 'package-lock.json'), join(root, 'package-lock.json'));
	symlinkSync(join(repositoryRoot, 'node_modules'), join(root, 'node_modules'), 'dir');
	execFileSync('git', ['init', '--quiet'], { cwd: root });
	execFileSync('git', ['add', 'src', 'tests', 'package-lock.json'], { cwd: root });
	execFileSync('git', ['-c', 'user.name=Coverage Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '--quiet', '-m', 'fixture'], { cwd: root });
	const revision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
	const policy = parseCoverageTestLayers({ schemaVersion: 1, kind: 'soundscaper-coverage-test-layers', defaultLayer: 'native',
		thresholds: { lines: 100, statements: 100, functions: 100, branches: 100 }, sources: [{
			path: sourcePath, layer: 'node-deterministic', sourceSha256: sha256Digest(fixtureSource), nodeTests: ['tests/example.test.ts'],
			nativeWitness: { spec: 'tests/browser/example.spec.js', title: 'uses the native real source', surfaces: [surface] },
			reason: 'The deterministic function is covered independently; native source execution is still mandatory.',
		}] });
	const evidenceRoot = join(root, 'evidence');
	const prepared = prepareQualifiedNodeArtifacts({ repositoryRoot: root, policy, selectedTestFiles: ['tests/example.test.ts'], outputRoot: evidenceRoot, expectedRevision: revision });
	assert.ok(prepared);
	const env: NodeJS.ProcessEnv = { ...process.env, NODE_OPTIONS: '--max-old-space-size=2048', NODE_V8_COVERAGE: join(root, 'ordinary-raw'),
		SCAPE_QUALIFIED_NODE_MANIFEST: prepared.manifestPath, SCAPE_QUALIFIED_NODE_OUTPUT: evidenceRoot };
	delete env.NODE_TEST_CONTEXT;
	const outcome = spawnSync(process.execPath, ['--import', join(repositoryRoot, 'scripts/qualified-node-preload.ts'), '--test', 'tests/example.test.ts'], {
		cwd: root, encoding: 'utf8', env,
	});
	assert.equal(outcome.status, 0, outcome.stdout + outcome.stderr);
	const inventory = { sourceRevision: revision, sources: [{ path: sourcePath, origin: 'repository', sha256: sha256Digest(fixtureSource), surfaces: [surface] }], scripts: [] };
	const gate = (path = evidenceRoot) => validateQualifiedNodeEvidence({ repositoryRoot: root, inventory, policy, evidenceRoots: [path], reportRoot: join(root, 'report'), expectedRevision: revision });
	return { root, evidenceRoot, gate, inventory, policy, revision };
}

test('genuine selected Node child qualifies its complete independently compiled artifact and missing evidence cannot fall back', () => {
	const value = fixture();
	try {
		const qualified = value.gate();
		assert.deepEqual(qualified.failures, []); assert.deepEqual([...qualified.qualifiedSources], [sourcePath]);
		for (const metric of Object.values(qualified.metrics) as { covered: number; total: number }[]) assert.equal(metric.covered, metric.total);
		const missing = validateQualifiedNodeEvidence({ repositoryRoot: value.root, inventory: value.inventory, policy: value.policy,
			evidenceRoots: [], reportRoot: join(value.root, 'missing'), expectedRevision: value.revision });
		assert.match(missing.failures.join('\n'), /require qualified Node evidence/u); assert.equal(missing.qualifiedSources.size, 0);
	} finally { rmSync(value.root, { recursive: true, force: true }); }
});

test('creating a returned anonymous guard without invoking it leaves a real source-derived function uncovered', () => {
	const value = fixture('export function createGuard(): () => number { return () => 1; }\n',
		`import assert from 'node:assert/strict';\nimport test from 'node:test';\nimport { createGuard } from '../${sourcePath}';\ntest('creates only', () => { assert.equal(typeof createGuard(), 'function'); });\n`);
	try {
		const rejected = value.gate();
		assert.equal(rejected.qualifiedSources.size, 0);
		assert.match(rejected.failures.join('\n'), /function .* has no positive Node invocation/u);
	} finally { rmSync(value.root, { recursive: true, force: true }); }
});

test('derived reports cannot overlap immutable evidence or enclose the repository', () => {
	const value = fixture();
	try {
		const manifest = readFileSync(join(value.evidenceRoot, 'manifest.json'));
		const sourceBytes = readFileSync(join(value.root, sourcePath));
		for (const reportRoot of [value.root, value.evidenceRoot, join(value.evidenceRoot, 'report')]) {
			const result = validateQualifiedNodeEvidence({ repositoryRoot: value.root, inventory: value.inventory, policy: value.policy,
				evidenceRoots: [value.evidenceRoot], reportRoot, expectedRevision: value.revision });
			assert.match(result.failures.join('\n'), /must not (?:overlap|enclose)/u);
			assert.deepEqual(readFileSync(join(value.evidenceRoot, 'manifest.json')), manifest);
			assert.deepEqual(readFileSync(join(value.root, sourcePath)), sourceBytes);
		}
	} finally { rmSync(value.root, { recursive: true, force: true }); }
});

test('full artifact topology rejects omitted functions even if altered raw and receipt agree on a root-only profile', () => {
	const value = fixture();
	try {
		const receiptPath = join(value.evidenceRoot, 'captures', readdirSync(join(value.evidenceRoot, 'captures'))[0]!);
		const profile = JSON.parse(readFileSync(receiptPath, 'utf8')) as QualifiedNodeProfile;
		for (const file of profile.qualifiedNode.rawFiles) {
			const path = join(value.evidenceRoot, file.path);
			const raw = JSON.parse(readFileSync(path, 'utf8')) as { result: { url: string; functions: unknown[] }[] };
			for (const entry of raw.result) if (entry.url.endsWith(sourcePath)) entry.functions = entry.functions.slice(0, 1);
			const bytes = Buffer.from(JSON.stringify(raw)); writeFileSync(path, bytes);
			Object.assign(file, { sha256: sha256Digest(bytes), byteLength: bytes.byteLength });
		}
		for (const entry of profile.result) Object.assign(entry, { functions: entry.functions.slice(0, 1) });
		writeFileSync(receiptPath, JSON.stringify(profile));
		const rejected = value.gate();
		assert.equal(rejected.qualifiedSources.size, 0);
		assert.match(rejected.failures.join('\n'), /missing the source-derived|function|topology/u);
	} finally { rmSync(value.root, { recursive: true, force: true }); }
});

test('forged implementation hashes, failed completion and stale source revisions fail before qualification', () => {
	const value = fixture();
	try {
		for (const fault of ['implementation', 'failed', 'revision']) {
			const copy = join(value.root, fault); cpSync(value.evidenceRoot, copy, { recursive: true });
			const path = join(copy, 'captures', readdirSync(join(copy, 'captures'))[0]!);
			const profile = JSON.parse(readFileSync(path, 'utf8')) as QualifiedNodeProfile;
			if (fault === 'implementation') Object.assign(profile.qualifiedNode.observations[0]!, { actualSha256: sha256Digest('mock') });
			if (fault === 'failed') Object.assign(profile.qualifiedNode, { status: 'failed', exitCode: 1 });
			if (fault === 'revision') Object.assign(profile.qualifiedNode, { sourceRevision: '0'.repeat(40) });
			writeFileSync(path, JSON.stringify(profile));
			const rejected = value.gate(copy); assert.ok(rejected.failures.length > 0, fault); assert.equal(rejected.qualifiedSources.size, 0, fault);
		}
	} finally { rmSync(value.root, { recursive: true, force: true }); }
});

test('Node-qualified native owners may be shallow, while every reported range and native root remains validated', () => {
	const root = mkdtempSync(join(tmpdir(), 'e2e-node-native-'));
	try {
		const code = 'function choose(value) { return value ? 1 : 2; }\n'; writeFileSync(join(root, 'module.js'), code);
		const script = { id: 'module', artifactPath: 'module.js', coverageUrl: 'file:///module.js', coverageKey: 'module', sourceMapSha256: null, sources: [sourcePath] };
		const entry = { scriptId: '1', url: script.coverageUrl, functions: [
			{ functionName: '', isBlockCoverage: true, ranges: [{ startOffset: 0, endOffset: code.length, count: 1 }] },
			{ functionName: 'choose', isBlockCoverage: false, ranges: [{ startOffset: 0, endOffset: code.trimEnd().length, count: 1 }] },
		] };
		const args = { artifactRoot: root, scripts: [script], profiles: [{ result: [entry] }] };
		assert.ok(validateE2ERawV8Topology(args).length > 0);
		assert.deepEqual(validateE2ERawV8Topology({ ...args, qualifiedNodeSources: new Set([sourcePath]) }), []);
		entry.functions[1]!.ranges[0]!.endOffset -= 1;
		assert.match(validateE2ERawV8Topology({ ...args, qualifiedNodeSources: new Set([sourcePath]) }).join('\n'), /not a source-derived/u);
		entry.functions = entry.functions.slice(1);
		assert.match(validateE2ERawV8Topology({ ...args, qualifiedNodeSources: new Set([sourcePath]) }).join('\n'), /missing the source-derived root/u);
	} finally { rmSync(root, { recursive: true, force: true }); }
});

test('integrated gate keeps the complete native inventory while independently qualifying Node and demanding an actual native function', () => {
	const value = fixture();
	try {
		const artifactRoot = join(value.root, 'native-artifacts'), rawRoot = join(value.root, 'native-raw');
		mkdirSync(artifactRoot); mkdirSync(rawRoot);
		const manifest = JSON.parse(readFileSync(join(value.evidenceRoot, 'manifest.json'), 'utf8')) as {
			modules: { codeFile: string; mapFile: string }[];
		};
		const module = manifest.modules[0]!;
		const nodeCode = readFileSync(join(value.evidenceRoot, module.codeFile), 'utf8');
		const nativeCode = 'function nativeChoice(value) { return value ? 1 : 2; }\nnativeChoice(true);\nnativeChoice(false);\n';
		writeFileSync(join(artifactRoot, 'node.mjs'), nodeCode); writeFileSync(join(artifactRoot, 'native.mjs'), nativeCode);
		execFileSync(process.execPath, ['--input-type=module', '-e',
			`const value = await import(${JSON.stringify(join(artifactRoot, 'node.mjs'))}); value.choose(true); await import(${JSON.stringify(join(artifactRoot, 'native.mjs'))});`],
		{ cwd: value.root, env: { ...process.env, NODE_V8_COVERAGE: rawRoot } });
		const original = JSON.parse(readFileSync(join(rawRoot, readdirSync(rawRoot)[0]!), 'utf8')) as {
			result: { scriptId: string; url: string; functions: unknown[] }[];
			'source-map-cache': Record<string, unknown>;
		};
		const nodeEntry = original.result.find(entry => entry.url.endsWith('/node.mjs'))!;
		const nativeEntry = original.result.find(entry => entry.url.endsWith('/native.mjs'))!;
		assert.ok(nodeEntry && nativeEntry);
		const nodeUrl = 'file:///__soundscaper_e2e__/browser/node.mjs', nativeUrl = 'file:///__soundscaper_e2e__/browser/native.mjs';
		const map = JSON.parse(readFileSync(join(value.evidenceRoot, module.mapFile), 'utf8')) as { sources: string[]; sourceRoot: string };
		map.sources = [`file:///__soundscaper_repo__/${sourcePath}`]; map.sourceRoot = '';
		const configuration = parseE2ECoverageConfiguration({ schemaVersion: 1,
			thresholds: { lines: 100, statements: 100, functions: 100, branches: 100 }, repositorySourceRoots: ['src/'],
			requiredSurfaces: [{ id: surface, coverageFormat: 'v8', description: 'Actual mapped native fixture renderer realm.' }],
			reason: 'The fixture preserves native source inventory and witnesses while requiring an independently complete Node source artifact.' });
		const scripts = [
			{ id: 'native.mjs', surface, artifactPath: 'native.mjs', coverageUrl: nativeUrl, sha256: sha256Digest(nativeCode), sourceMapSha256: null, sources: ['generated/native.mjs'] },
			{ id: 'node.mjs', surface, artifactPath: 'node.mjs', coverageUrl: nodeUrl, sha256: sha256Digest(nodeCode), sourceMapSha256: stableSha256Digest(map), sources: [sourcePath] },
		].map(script => ({ ...script, coverageKey: e2eExecutableCoverageKey(script) }));
		const unsigned = { schemaVersion: 1, kind: 'soundscaper-e2e-executable-inventory', sourceRevision: value.revision,
			sources: [{ path: 'generated/native.mjs', origin: 'artifact', artifactPath: 'native.mjs', sha256: sha256Digest(nativeCode), surfaces: [surface] }, ...value.inventory.sources], scripts };
		const inventory = { ...unsigned, digest: digestE2EInventory(unsigned) };
		writeFileSync(join(artifactRoot, 'inventory.json'), JSON.stringify(inventory));
		const surfaceRoot = join(artifactRoot, 'surfaces', surface); mkdirSync(join(surfaceRoot, 'v8'), { recursive: true });
		const profile = { result: [{ ...nativeEntry, url: nativeUrl }, { ...nodeEntry, url: nodeUrl }],
			'source-map-cache': { [nodeUrl]: { data: map } } };
		writeFileSync(join(surfaceRoot, 'v8/coverage.json'), JSON.stringify(profile));
		const surfaceManifest = { schemaVersion: 1, kind: 'soundscaper-e2e-coverage-surface', surface,
			sourceRevision: value.revision, inventoryDigest: inventory.digest,
			coverage: { format: 'v8', path: 'v8', files: coverageFileRecords(join(surfaceRoot, 'v8')) },
			inventoriedScripts: scripts.map(script => ({ id: script.id, sha256: script.sha256 })) };
		writeFileSync(join(surfaceRoot, 'manifest.json'), JSON.stringify(surfaceManifest));
		const locator = copyQualifiedNodeEvidence({ inputRoots: [value.evidenceRoot], outputRoot: artifactRoot });
		writeFileSync(join(artifactRoot, 'node-evidence.json'), JSON.stringify(locator));
		const run = () => runE2ECoverageGate({ repositoryRoot: value.root, artifactRoot,
			reportRoot: join(value.root, 'integrated-report'), configuration, layerPolicy: value.policy, expectedRevision: value.revision });
		const passed = run();
		assert.deepEqual(passed.failures, []); assert.equal(passed.files, 2); assert.equal(passed.surfaces, 1);
		assert.deepEqual(passed.nodeCoverage.sources, [sourcePath]); assert.equal(passed.metrics.branches.percentage, 100);
		assert.match(formatE2ECoverageResult(passed), /Independent qualified Node coverage \(1 full compiled artifacts\):\n {2}lines 100\.00%/u);
		const sourceFunction = (profile.result[1]!.functions as { ranges: { endOffset: number; count: number }[] }[])
			.find(fn => fn.ranges[0]!.endOffset !== nodeCode.length)!;
		assert.ok(sourceFunction);
		for (const range of sourceFunction.ranges) range.count = 0;
		writeFileSync(join(surfaceRoot, 'v8/coverage.json'), JSON.stringify(profile));
		surfaceManifest.coverage.files = coverageFileRecords(join(surfaceRoot, 'v8'));
		writeFileSync(join(surfaceRoot, 'manifest.json'), JSON.stringify(surfaceManifest));
		assert.match(run().failures.join('\n'), /positive mapped.*non-root function/u, 'Node100 never replaces actual native invocation');
	} finally { rmSync(value.root, { recursive: true, force: true }); }
});
