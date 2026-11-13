/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test, { type TestContext } from 'node:test';

import { prepareQualifiedNodeArtifacts, qualifiedNodeHash, type QualifiedNodeProfile } from '../scripts/lib/qualified-node-artifacts.ts';
import { validateQualifiedNodeEvidence } from '../scripts/lib/e2e-coverage-node-gate.mjs';

const repositoryRoot = resolve(import.meta.dirname, '..');
const source = 'export function choose(value: boolean): number { return value ? 1 : 2; }\n';
const sourcePaths = ['src/a/example.ts', 'src/b/example.ts'];
const testPaths = ['tests/0.test.ts', 'tests/1.test.ts'];
const surface = 'browser-chromium-soundscaper-renderer';

function fixture(context: TestContext, source: string) {
	const root = mkdtempSync(join(tmpdir(), 'qualified-independent-sources-'));
	context.after(() => { rmSync(root, { recursive: true, force: true }); });
	const write = (path: string, bytes: string | Uint8Array) => {
		mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), bytes);
	};
	for (const [index, path] of sourcePaths.entries()) {
		write(path, source);
		write(testPaths[index]!, `import assert from 'node:assert/strict';import test from 'node:test';import{choose}from'../${path}';test('actual source outcomes',()=>{assert.equal(choose(true),1);if(process.env.SCAPE_PARTIAL_SOURCE!==${JSON.stringify(String(index))})assert.equal(choose(false),2);});\n`);
	}
	write('tests/browser/example.spec.js', '// Unit policy fixture; native runtime custody is checked separately.\n');
	write('package.json', '{"type":"module"}\n'); write('package-lock.json', readFileSync(join(repositoryRoot, 'package-lock.json')));
	symlinkSync(join(repositoryRoot, 'node_modules'), join(root, 'node_modules'), 'dir');
	execFileSync('git', ['init', '--quiet'], { cwd: root });
	execFileSync('git', ['add', 'src', 'tests', 'package.json', 'package-lock.json'], { cwd: root });
	execFileSync('git', ['-c', 'user.name=Coverage fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '--quiet', '-m', 'Pin independent source fixture'], { cwd: root });
	const revision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
	const policy = { schemaVersion: 1, kind: 'soundscaper-coverage-test-layers', defaultLayer: 'native',
		thresholds: { lines: 100, statements: 100, functions: 100, branches: 100 },
		sources: sourcePaths.map((path, index) => ({ path, layer: 'node-deterministic', sourceSha256: qualifiedNodeHash(source), nodeTests: [testPaths[index]],
			nativeWitness: { spec: 'tests/browser/example.spec.js', title: 'real native fixture witness', surfaces: [surface] },
			reason: 'Every deterministic policy source needs independent full-artifact coverage even when emitted bytes match another source.' })) };
	const evidenceRoot = join(root, 'qualified'), ordinaryRaw = join(root, 'ordinary-raw');
	const prepared = prepareQualifiedNodeArtifacts({ repositoryRoot: root, policy, selectedTestFiles: testPaths, outputRoot: evidenceRoot, expectedRevision: revision });
	assert.ok(prepared);
	assert.equal(prepared.manifest.modules[0]!.generatedSha256, prepared.manifest.modules[1]!.generatedSha256, 'same basename and source bytes create the same compiled artifact');
	const inventory = { sourceRevision: revision,
		sources: sourcePaths.map(path => ({ path, origin: 'repository', sha256: qualifiedNodeHash(source), surfaces: [surface] })), scripts: [] };
	const gate = (inputRoot = evidenceRoot) => validateQualifiedNodeEvidence({ repositoryRoot: root, inventory, policy, evidenceRoots: [inputRoot], reportRoot: join(root, 'report'), expectedRevision: revision });
	const execute = (partial: boolean) => {
		for (const path of [join(evidenceRoot, 'captures'), join(evidenceRoot, 'raw'), ordinaryRaw]) rmSync(path, { recursive: true, force: true });
		const env: NodeJS.ProcessEnv = { ...process.env, NODE_OPTIONS: '--max-old-space-size=2048', NODE_V8_COVERAGE: ordinaryRaw,
			SCAPE_QUALIFIED_NODE_MANIFEST: prepared.manifestPath, SCAPE_QUALIFIED_NODE_OUTPUT: evidenceRoot,
			SCAPE_QUALIFIED_NODE_TESTS: JSON.stringify(testPaths.map(path => join(root, path))), SCAPE_PARTIAL_SOURCE: partial ? '0' : '' };
		delete env.NODE_TEST_CONTEXT;
		const outcome = spawnSync(process.execPath, ['--import', join(repositoryRoot, 'scripts/qualified-node-dispatch.mjs'), '--test', '--test-concurrency=1', ...testPaths],
			{ cwd: root, env, encoding: 'utf8' });
		assert.ifError(outcome.error); assert.equal(outcome.status, 0, outcome.stdout + outcome.stderr);
	};
	return { root, evidenceRoot, ordinaryRaw, prepared, gate, execute };
}

test('identical prepared modules keep independent denominators when both complete or one partial/collapsed', context => {
	const { evidenceRoot, prepared, gate, execute } = fixture(context, source);
	execute(false);
	const complete = gate(); assert.deepEqual(complete.failures, []); assert.deepEqual([...complete.qualifiedSources], sourcePaths);
	assert.equal(complete.files, 2, 'identical compiled bytes retain two separate source denominators');
	execute(true);
	const partial = gate(); assert.equal(partial.qualifiedSources.size, 0);
	assert.match(partial.failures.join('\n'), /src\/a\/example\.ts.*incomplete branch|src\/a\/example\.ts Node branches/u);

	assert.ok(omitZeroMasks(evidenceRoot, prepared.manifest.modules[0]!.sourceUrl) > 0);
	const collapsed = gate(); assert.equal(collapsed.qualifiedSources.size, 0);
	assert.match(collapsed.failures.join('\n'), /src\/a\/example\.ts.*source-derived branch topology/u);
});

test('genuine loop coverage and coherently omitted zero masks fail before c8 when independent loop topology is unsupported', context => {
	const f = fixture(context, 'export function choose(value: boolean): number { while (value) { return 1; } return 2; }\n');
	f.execute(true);
	const ordinaryPreimages = readdirSync(f.ordinaryRaw).map(name => ({ name, bytes: readFileSync(join(f.ordinaryRaw, name)) }));
	const qualifiedPreimages = readdirSync(join(f.evidenceRoot, 'raw')).map(name => ({ name, bytes: readFileSync(join(f.evidenceRoot, 'raw', name)) }));
	const original = f.gate(); assert.equal(original.qualifiedSources.size, 0);
	assert.match(original.failures.join('\n'), /unsupported independent Node branch topology \(WhileStatement/u);
	const altered = join(f.root, 'omitted-mask'); cpSync(f.evidenceRoot, altered, { recursive: true });
	assert.ok(omitZeroMasks(altered, f.prepared.manifest.modules[0]!.sourceUrl) > 0, 'the real partial loop had a zero outcome to omit');
	const collapsed = f.gate(altered); assert.equal(collapsed.qualifiedSources.size, 0);
	assert.match(collapsed.failures.join('\n'), /unsupported independent Node branch topology \(WhileStatement/u);
	assert.equal(existsSync(join(f.root, 'report')), false, 'unsupported syntax is rejected before c8 materialization');
	for (const preimage of ordinaryPreimages) assert.deepEqual(readFileSync(join(f.ordinaryRaw, preimage.name)), preimage.bytes);
	for (const preimage of qualifiedPreimages) assert.deepEqual(readFileSync(join(f.evidenceRoot, 'raw', preimage.name)), preimage.bytes);
});

function omitZeroMasks(evidenceRoot: string, targetUrl: string): number {
	const names = readdirSync(join(evidenceRoot, 'captures'));
	const selected = names.find(name => {
		const profile = JSON.parse(readFileSync(join(evidenceRoot, 'captures', name), 'utf8')) as QualifiedNodeProfile;
		return profile.qualifiedNode.nodeTestPath === testPaths[0];
	}); assert.ok(selected);
	const receiptPath = join(evidenceRoot, 'captures', selected);
	const profile = JSON.parse(readFileSync(receiptPath, 'utf8')) as QualifiedNodeProfile;
	let removed = 0;
	for (const entry of profile.result) for (const fn of entry.functions) {
		const ranges = fn.ranges.filter((range, index) => index === 0 || range.count !== 0);
		removed += fn.ranges.length - ranges.length; Object.assign(fn, { ranges });
	}
	assert.ok(removed > 0, 'actual partial execution emitted a zero branch mask');
	// Keep receipt/raw custody consistent: only the independent source topology
	// can reject this omitted zero outcome; the other source is fully covered.
	for (const file of profile.qualifiedNode.rawFiles) {
		const path = join(evidenceRoot, file.path), raw = JSON.parse(readFileSync(path, 'utf8')) as { result: QualifiedNodeProfile['result'] };
		for (const entry of raw.result) if (entry.url === targetUrl) for (const fn of entry.functions) {
			Object.assign(fn, { ranges: fn.ranges.filter((range, index) => index === 0 || range.count !== 0) });
		}
		const bytes = Buffer.from(JSON.stringify(raw)); writeFileSync(path, bytes);
		Object.assign(file, { sha256: qualifiedNodeHash(bytes), byteLength: bytes.length });
	}
	writeFileSync(receiptPath, JSON.stringify(profile));
	return removed;
}
