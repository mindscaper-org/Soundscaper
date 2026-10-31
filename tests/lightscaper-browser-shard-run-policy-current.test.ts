/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import test from 'node:test';
import { browserShardRunPolicy } from '../scripts/lib/browser-shard-run-policy.ts';
import { currentModuleSourceFingerprint } from '../scripts/lib/check-module-repository.ts';

const root = resolve('tests/browser');
function collection(file = 'audio-editor-fixture.spec.js') {
	return { config: { rootDir: root, workers: 2, shard: { current: 1, total: 4 },
		projects: [{ name: 'chromium', retries: 1, repeatEach: 1 }] }, errors: [] as unknown[],
		suites: [{ specs: [{ id: 'actual-case', file, tests: [{ projectName: 'chromium', results: [] as unknown[] }] }] }] };
}
const options = { project: 'chromium', shard: '1/4', workers: 2, testRoot: root } as const;

test('ordinary shards retain their existing worker count and CI one-retry policy', () => {
	assert.deepEqual(browserShardRunPolicy(collection(), options), { workers: 2, retries: 1, collectedTests: 1, lightscaperTests: 0 });
	const report = collection(); report.config.workers = 1;
	assert.deepEqual(browserShardRunPolicy(report, { ...options, workers: 1 }), { workers: 1, retries: 1, collectedTests: 1, lightscaperTests: 0 });
});

test('any collected Lightscaper filename selects the entire shard at one worker and zero retries', () => {
	const report = collection('lightscaper-future-workflow.spec.ts');
	report.suites[0]!.specs.push({ id: 'ordinary-peer', file: 'audio-editor-peer.spec.js', tests: [{ projectName: 'chromium', results: [] }] });
	assert.deepEqual(browserShardRunPolicy(report, options), { workers: 1, retries: 0, collectedTests: 2, lightscaperTests: 1 });
});

test('collection errors, an empty shard and already-executed reports refuse a run-shape decision', () => {
	const bad = collection(); bad.errors.push({ message: 'actual load failure' });
	assert.throws(() => browserShardRunPolicy(bad, options), /load errors/u);
	const empty = collection(); empty.suites = [];
	assert.throws(() => browserShardRunPolicy(empty, options), /no tests/u);
	const ran = collection(); ran.suites[0]!.specs[0]!.tests[0]!.results.push({ status: 'passed' });
	assert.throws(() => browserShardRunPolicy(ran, options), /unexecuted/u);
});

test('an explicitly admitted focused module shard may be empty while malformed reports still refuse', () => {
	const empty = collection(); empty.suites = [];
	assert.deepEqual(browserShardRunPolicy(empty, { ...options, allowEmpty: true }),
		{ workers: 2, retries: 1, collectedTests: 0, lightscaperTests: 0 });
	empty.errors.push({ message: 'actual load failure' });
	assert.throws(() => browserShardRunPolicy(empty, { ...options, allowEmpty: true }), /load errors/u);
});

test('a wrong project, shard, ordinary worker count or CI retry policy cannot select a different workload', () => {
	const project = collection(); project.suites[0]!.specs[0]!.tests[0]!.projectName = 'firefox';
	assert.throws(() => browserShardRunPolicy(project, options), /selected project/u);
	const shard = collection(); shard.config.shard.current = 2;
	assert.throws(() => browserShardRunPolicy(shard, options), /shard differs/u);
	const workers = collection(); workers.config.workers = 1;
	assert.throws(() => browserShardRunPolicy(workers, options), /workers or shard/u);
	const retries = collection(); retries.config.projects[0]!.retries = 0;
	assert.throws(() => browserShardRunPolicy(retries, options), /one retry/u);
});

test('escaped source files, duplicate identities and invalid shard bounds are refused', () => {
	assert.throws(() => browserShardRunPolicy(collection('../lightscaper-foreign.spec.js'), options), /escaped/u);
	const duplicate = collection(); duplicate.suites[0]!.specs.push(duplicate.suites[0]!.specs[0]!);
	assert.throws(() => browserShardRunPolicy(duplicate, options), /Duplicate/u);
	assert.throws(() => browserShardRunPolicy(collection(), { ...options, shard: '5/4' }), /bounds/u);
});

test('actual Playwright list JSON selects the collected Lightscaper shard without running its test body', async context => {
	const repository = fileURLToPath(new URL('../', import.meta.url));
	const directory = await realpath(await mkdtemp(join(tmpdir(), 'lightscaper-shard-list-'))), testRoot = join(directory, 'tests');
	let safeToRemove = false;
	context.after(async () => { if (safeToRemove) await rm(directory, { recursive: true, force: true }); });
	await mkdir(testRoot);
	const moduleURL = pathToFileURL(join(repository, 'node_modules/@playwright/test/index.mjs')).href;
	const config = join(directory, 'playwright.config.mjs');
	await writeFile(config, `import { defineConfig } from ${JSON.stringify(moduleURL)};\nexport default defineConfig({ testDir: ${JSON.stringify(testRoot)}, fullyParallel: true, projects: [{ name: 'chromium' }] });\n`);
	for (const name of ['audio-editor-fixture', 'lightscaper-fixture']) {
		await writeFile(join(testRoot, `${name}.spec.mjs`), `import { test } from ${JSON.stringify(moduleURL)};\ntest(${JSON.stringify(name)}, () => { throw new Error('List-only fixture bodies must never execute.'); });\n`);
	}
	const run = promisify(execFile), observed = [];
	for (const current of [1, 2]) {
		const shard = `${String(current)}/2`;
		const result = await run(process.execPath, [join(repository, 'node_modules/@playwright/test/cli.js'), 'test',
			`--config=${config}`, '--project=chromium', `--shard=${shard}`, '--workers=2', '--retries=1', '--list', '--reporter=json'],
		{ cwd: repository, env: { ...process.env, CI: 'true', PWTEST_SHARD_WEIGHTS: '' }, timeout: 30_000, maxBuffer: 4 * 1024 * 1024 });
		const report: unknown = JSON.parse(result.stdout);
		observed.push(browserShardRunPolicy(report, { project: 'chromium', shard, workers: 2, testRoot }));
	}
	assert.deepEqual(observed, [{ workers: 2, retries: 1, collectedTests: 1, lightscaperTests: 0 },
		{ workers: 1, retries: 0, collectedTests: 1, lightscaperTests: 1 }]);
	safeToRemove = true;
});

test('CI empty-shard admission requires a valid focused plan for the current checkout', async context => {
	const repository = fileURLToPath(new URL('../', import.meta.url));
	const directory = await realpath(await mkdtemp(join(tmpdir(), 'lightscaper-module-shard-')));
	context.after(() => rm(directory, { recursive: true, force: true }));
	const run = promisify(execFile);
	await run('git', ['init', '--quiet', directory]);
	await run('git', ['-C', directory, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid',
		'commit', '--allow-empty', '--quiet', '-m', 'Fixture']);
	await mkdir(join(directory, 'config'));
	await mkdir(join(directory, 'tests/browser'), { recursive: true });
	await writeFile(join(directory, '.gitignore'), 'plan.json\ncollection.json\n');
	await writeFile(join(directory, 'config/module-policy.json'), JSON.stringify({ schemaVersion: 1,
		modules: [{ id: 'imaging', sourcePrefixes: ['src/common/imaging/'] }], globalInputs: [] }));
	const revision = (await run('git', ['-C', directory, 'rev-parse', 'HEAD'])).stdout.trim();
	const report = collection(); report.suites = []; report.config.rootDir = join(directory, 'tests/browser');
	await writeFile(join(directory, 'collection.json'), JSON.stringify(report));
	const plan = { schemaVersion: 1, revision, comparisonRevision: null,
		sourceFingerprint: currentModuleSourceFingerprint(directory), mode: 'focused', modules: ['imaging'],
		nodeTests: [], browserTests: [], products: ['lightscaper'], reasons: [] };
	const invoke = (selected: boolean) => run(process.execPath, [join(repository, 'scripts/ci-browser-shard-policy.ts'),
		'collection.json', 'chromium', '1/4', '2'], { cwd: directory, timeout: 30_000,
		env: { ...process.env, SCAPE_MODULE_PLAN: selected ? 'plan.json' : '' } });
	await writeFile(join(directory, 'plan.json'), JSON.stringify({ ...plan, mode: 'full' }));
	await assert.rejects(() => invoke(false), /collected no tests/u);
	await assert.rejects(() => invoke(true), /collected no tests/u);
	await writeFile(join(directory, 'plan.json'), JSON.stringify(plan));
	assert.equal((await invoke(true)).stdout, 'workers=2\nretries=1\n');
	await writeFile(join(directory, 'plan.json'), JSON.stringify({ ...plan, revision: '0'.repeat(40) }));
	await assert.rejects(() => invoke(true), /wrong source revision/u);
	await writeFile(join(directory, 'plan.json'), JSON.stringify({ ...plan, sourceFingerprint: '0'.repeat(64) }));
	await assert.rejects(() => invoke(true), /fingerprint/u);
});
