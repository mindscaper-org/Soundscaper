/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

import { createNightlyTestsControl } from '../desktop/nightly-tests-control.ts';

test('pause cancels active tests; resume preserves completed verdicts and reruns unfinished tests', async (context) => {
	const root = await mkdtemp(join(tmpdir(), 'nightly-pause-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	const playwrightURL = new URL('../node_modules/@playwright/test/index.mjs', import.meta.url).href;
	const reporter = fileURLToPath(new URL('../scripts/lib/desktop-nightly-tests-progress-reporter.mjs', import.meta.url));
	const cli = fileURLToPath(new URL('../node_modules/@playwright/test/cli.js', import.meta.url));
	const config = join(root, 'playwright.config.mjs');
	await writeFile(config, `export default {
		testDir: ${JSON.stringify(root)}, testMatch: 'fixture.spec.mjs',
		workers: 1, retries: 0, timeout: 20000,
		projects: [{ name: 'pause-fixture' }],
		reporter: [[${JSON.stringify(reporter)}],
			['html', { outputFolder: ${JSON.stringify(join(root, 'playwright-report'))}, open: 'never' }],
			['json', { outputFile: ${JSON.stringify(join(root, 'results.json'))} }],
			['junit', { outputFile: ${JSON.stringify(join(root, 'junit.xml'))} }]],
		outputDir: ${JSON.stringify(join(root, 'test-results'))},
	};`);
	await writeFile(join(root, 'fixture.spec.mjs'), `import { test, expect } from ${JSON.stringify(playwrightURL)};
		import { appendFileSync, existsSync, writeFileSync } from 'node:fs';
		const record = name => appendFileSync(${JSON.stringify(join(root, 'executions'))}, name + '\\n');
		test('completed pass', async ({}, info) => {
			record('pass'); console.log('PASS_EVIDENCE');
			writeFileSync(${JSON.stringify(join(root, 'evidence.txt'))}, 'verified completed evidence');
			await info.attach('completed evidence', { path: ${JSON.stringify(join(root, 'evidence.txt'))}, contentType: 'text/plain' });
		});
		test('completed failure', () => { record('failure'); expect(1).toBe(2); });
		test('interrupted work', async () => {
			record('interrupted'); console.log('INTERRUPTED_EVIDENCE');
			if (!existsSync(${JSON.stringify(join(root, 'resume'))})) {
				writeFileSync(${JSON.stringify(join(root, 'worker.pid'))}, String(process.pid));
				await new Promise(() => {});
			}
		});
		test('pending work', () => { record('pending'); });
	`);
	let paused!: () => void;
	const whenPaused = new Promise<void>((resolve) => { paused = resolve; });
	const states: string[] = [];
	const control = createNightlyTestsControl({ onState: (state) => {
		states.push(state);
		if (state === 'paused') paused();
	} });
	const updates: number[] = [];
	let requested = false;
	const run = control.runPlaywright({
		command: process.execPath, args: [cli, 'test', '--config', config],
		cwd: fileURLToPath(new URL('..', import.meta.url)),
		env: {}, logFile: join(root, 'console.log'),
	}, (items) => {
		updates.push(items.completed);
		if (!requested && items.label.includes('interrupted work') && items.completed === 2) {
			requested = true;
			control.pause();
		}
	});
	await whenPaused;
	assert.equal(control.state, 'paused');
	assert.deepEqual((await readFile(join(root, 'executions'), 'utf8')).trim().split('\n'), ['pass', 'failure', 'interrupted']);
	const pid = Number(await readFile(join(root, 'worker.pid'), 'utf8'));
	assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' }, 'the test worker exits before pause completes');
	await writeFile(join(root, 'resume'), 'resume');
	control.resume();
	assert.deepEqual(await run, { code: 1, signal: null });
	assert.deepEqual(states, ['pausing', 'paused', 'running']);
	assert.deepEqual((await readFile(join(root, 'executions'), 'utf8')).trim().split('\n'),
		['pass', 'failure', 'interrupted', 'interrupted', 'pending']);
	assert.ok(updates.every((value, index) => index === 0 || value >= updates[index - 1]!));
	assert.equal(updates.at(-1), 4);
	const report = JSON.parse(await readFile(join(root, 'results.json'), 'utf8')) as {
		stats: { expected: number; unexpected: number; skipped: number; flaky: number };
		suites: { specs: { tests: { results: { attachments: { path: string }[] }[] }[] }[] }[];
	};
	assert.equal(report.stats.expected, 3);
	assert.equal(report.stats.unexpected, 1);
	assert.equal(report.stats.skipped, 0);
	assert.equal(report.stats.flaky, 0);
	const attachment = report.suites[0]!.specs[0]!.tests[0]!.results[0]!.attachments[0]!;
	assert.equal(await readFile(attachment.path, 'utf8'), 'verified completed evidence');
	assert.match(await readFile(join(root, 'playwright-report/index.html'), 'utf8'), /Playwright/u);
	assert.match(await readFile(join(root, 'junit.xml'), 'utf8'), /completed failure/u);
	const log = await readFile(join(root, 'console.log'), 'utf8');
	assert.equal(log.match(/PASS_EVIDENCE/gu)?.length, 1);
	assert.equal(log.match(/INTERRUPTED_EVIDENCE/gu)?.length, 1, 'canceled diagnostic output is excluded');
});

test('pausing between phases prevents the next child from starting, including repeated requests', async () => {
	const control = createNightlyTestsControl();
	control.pause();
	control.pause();
	assert.equal(control.state, 'paused');
	control.resume();
	control.resume();
	assert.equal(control.state, 'running');
});

test('repeated pauses cancel every parallel worker and continue the original test inventory', async (context) => {
	const { root, plan } = await scenario(context, `
		test('already completed', () => { record('complete'); });
		for (const id of ['one', 'two']) test('worker '+id, async () => {
			record(id);
			writeFileSync(root+'/'+id+'.pid', String(process.pid));
			if (!existsSync(root+'/resume-final')) await new Promise(() => {});
		});
	`, { fullyParallel: true, workers: 2 });
	let pauses = 0;
	let completed = 0;
	const control = createNightlyTestsControl();
	control.pause();
	const run = control.runPlaywright(plan, (items) => { completed = items.completed; });
	await delay(30);
	await assert.rejects(readFile(join(root, 'executions')), { code: 'ENOENT' });
	control.resume();
	while (pauses < 2) {
		const pids = await waitFor(async () => {
			const values = await Promise.all(['one', 'two'].map((id) => readFile(join(root, `${id}.pid`), 'utf8').catch(() => null)));
			return values.every((value) => value !== null) ? values.map(Number) : null;
		});
		control.pause();
		control.pause();
		await waitFor(() => Promise.resolve(control.state === 'paused' ? true : null));
		assert.ok(completed >= 1);
		for (const pid of pids) assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
		for (const id of ['one', 'two']) await rm(join(root, `${id}.pid`));
		pauses += 1;
		if (pauses === 2) await writeFile(join(root, 'resume-final'), 'resume');
		control.resume();
	}
	assert.deepEqual(await run, { code: 0, signal: null });
	const executions = (await readFile(join(root, 'executions'), 'utf8')).trim().split('\n');
	assert.equal(executions.filter((name) => name === 'complete').length, 1);
	for (const id of ['one', 'two']) assert.equal(executions.filter((name) => name === id).length, 3);
	assert.equal(completed, 3);
});

test('resume replays a partly completed serial group and discards its canceled results', async (context) => {
	const { root, plan } = await scenario(context, `
		test.describe.serial('shared state', () => {
			let initialized = false;
			test('initialize', () => { initialized = true; record('initialize'); });
			test('consume', async () => {
				expect(initialized).toBe(true); record('consume');
				writeFileSync(root+'/active', 'active');
				if (!existsSync(root+'/resume-final')) await new Promise(() => {});
			});
		});
	`);
	const control = createNightlyTestsControl();
	const run = control.runPlaywright(plan);
	await waitFor(() => readFile(join(root, 'active'), 'utf8').catch(() => null));
	control.pause();
	await waitFor(() => Promise.resolve(control.state === 'paused' ? true : null));
	await writeFile(join(root, 'resume-final'), 'resume');
	control.resume();
	assert.deepEqual(await run, { code: 0, signal: null });
	assert.equal((await readFile(join(root, 'executions'), 'utf8')).trim(), 'initialize\nconsume\ninitialize\nconsume');
	const report = JSON.parse(await readFile(join(root, 'results.json'), 'utf8')) as { stats: { expected: number; flaky: number } };
	assert.equal(report.stats.expected, 2);
	assert.equal(report.stats.flaky, 0);
});

test('completed retries, expected failures, and skips keep their verdicts after resume', async (context) => {
	const { root, plan } = await scenario(context, `
		test('flaky', ({}, info) => { record('flaky'); expect(info.retry).toBe(1); });
		test.skip('intentional skip', () => {});
		test('expected failure', () => { test.fail(); record('expected'); expect(1).toBe(2); });
		test('interrupted', async () => {
			record('interrupted'); writeFileSync(root+'/active', 'active');
			if (!existsSync(root+'/resume-final')) await new Promise(() => {});
		});
	`, { retries: 1, failOnFlakyTests: true });
	const control = createNightlyTestsControl();
	const run = control.runPlaywright(plan);
	await waitFor(() => readFile(join(root, 'active'), 'utf8').catch(() => null));
	control.pause();
	await waitFor(() => Promise.resolve(control.state === 'paused' ? true : null));
	await writeFile(join(root, 'resume-final'), 'resume');
	control.resume();
	assert.deepEqual(await run, { code: 1, signal: null });
	assert.equal((await readFile(join(root, 'executions'), 'utf8')).trim(), 'flaky\nflaky\nexpected\ninterrupted\ninterrupted');
	const report = JSON.parse(await readFile(join(root, 'results.json'), 'utf8')) as {
		stats: { expected: number; unexpected: number; skipped: number; flaky: number };
	};
	assert.deepEqual([report.stats.expected, report.stats.unexpected, report.stats.skipped, report.stats.flaky], [2, 0, 1, 1]);
});

async function scenario(context: test.TestContext, source: string, options = {}) {
	const root = await mkdtemp(join(tmpdir(), 'nightly-pause-lifecycle-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	const cli = fileURLToPath(new URL('../node_modules/@playwright/test/cli.js', import.meta.url));
	const playwright = new URL('../node_modules/@playwright/test/index.mjs', import.meta.url).href;
	const config = join(root, 'playwright.config.mjs');
	await writeFile(config, `export default ${JSON.stringify({
		testDir: root, testMatch: 'fixture.spec.mjs', workers: 1, retries: 0, timeout: 20_000,
		projects: [{ name: 'lifecycle' }], reporter: [['json', { outputFile: join(root, 'results.json') }]],
		...options,
	})};`);
	await writeFile(join(root, 'fixture.spec.mjs'), `import { test, expect } from ${JSON.stringify(playwright)};
		import { appendFileSync, existsSync, writeFileSync } from 'node:fs';
		const root = ${JSON.stringify(root)};
		const record = name => appendFileSync(root+'/executions',name+'\\n');
		${source}`);
	return { root, plan: { command: process.execPath, args: [cli, 'test', '--config', config],
		cwd: fileURLToPath(new URL('..', import.meta.url)), env: {}, logFile: join(root, 'console.log') } };
}

async function waitFor<T>(read: () => Promise<T | null>): Promise<T> {
	const timeout = Date.now() + 20_000;
	while (Date.now() < timeout) {
		const value = await read();
		if (value !== null) return value;
		await delay(10);
	}
	throw new Error('Nightly pause fixture did not reach its expected state.');
}
