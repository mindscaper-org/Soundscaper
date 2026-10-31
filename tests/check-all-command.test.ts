/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import test from 'node:test';

import { createCheckAllPlan } from '../scripts/lib/check-all-plan.ts';

const root = resolve(import.meta.dirname, '..');
let supported = process.platform === 'linux';
if (supported) {
	try { execFileSync('systemd-run', ['--user', '--scope', '--quiet', '--property=MemoryMax=8G', '--property=MemorySwapMax=0', '/usr/bin/true'], { stdio: 'ignore', timeout: 5_000 }); }
	catch { supported = false; }
}

test('check-all command schedules fixture jobs, reports failures, waits for fresh coverage and cleans up', { skip: !supported, timeout: 30_000 }, async context => {
	const fixture = await mkdtemp(join(tmpdir(), 'scape-check-all-command-'));
	context.after(() => rm(fixture, { recursive: true, force: true }));
	await mkdir(join(fixture, 'scripts/lib'), { recursive: true });
	await mkdir(join(fixture, 'node_modules/@playwright/test'), { recursive: true });
	for (const file of ['check-all.ts', 'check-all-task.ts',
		'lib/check-all-plan.ts', 'lib/check-all-scheduler.ts', 'lib/check-all-process.ts', 'lib/check-all-output.ts',
		'lib/lint-shards.mjs', 'lib/node-test-shards.mjs']) {
		await cp(join(root, 'scripts', file), join(fixture, 'scripts', file));
	}
	const scripts = {
		'check:static': 'npm run lint && npm run typecheck && npm run check:architecture && npm run audit:ci && npm run docs:check && npm run build',
		typecheck: 'npm run typecheck:sources && npm run typecheck:tests',
	};
	await writeFile(join(fixture, 'package.json'), JSON.stringify({ type: 'module', scripts }));
	const firstWave = createCheckAllPlan(fixture, join(fixture, 'fake-npm.mjs'), scripts).slice(0, 4);
	assert.equal(firstWave.length, 4);
	assert.ok(firstWave.every(task => task.dependsOn.length === 0), 'The rendezvous requires four independently admitted initial tasks.');
	const firstWaveNames = firstWave.map(task => `${basename(task.args[0]!)}:${task.args.slice(1).join(' ')}`);
	assert.equal(new Set(firstWaveNames).size, 4);
	const stub = `
		import {appendFileSync, readdirSync, writeFileSync} from 'node:fs';
		import {basename} from 'node:path';
		import {setTimeout} from 'node:timers/promises';
		const name = basename(process.argv[1]) + ':' + process.argv.slice(2).join(' ');
		const record = type => appendFileSync('activity.jsonl', JSON.stringify({type, name}) + '\\n');
		const progress = value => console.log('SCAPE_CHECK_ALL ' + JSON.stringify(value));
		record('start');
		progress({type: 'start', id: name, label: 'fixture running'});
		console.log('passing-result-noise');
		console.log('Error: expected stdout diagnostic');
		console.error('Error: expected stderr diagnostic');
		const firstWave = ${JSON.stringify(firstWaveNames)};
		const member = firstWave.indexOf(name);
		if (member >= 0) {
			// All four actual stubs must start before any can finish, regardless of scope startup timing.
			writeFileSync('first-wave-ready/' + member, name);
			const deadline = performance.now() + 5_000;
			for (;;) {
				const arrived = new Set(readdirSync('first-wave-ready'));
				const missing = firstWave.filter((_, index) => !arrived.has(String(index)));
				if (missing.length === 0) break;
				if (performance.now() >= deadline) throw new Error('Fixture first-four rendezvous timed out; arrived: '
					+ firstWave.filter((_, index) => arrived.has(String(index))).join(', ') + '; missing: ' + missing.join(', '));
				await setTimeout(10);
			}
		}
		await setTimeout(80);
		const failed = process.env.FIXTURE_FAIL === '1' && process.argv.includes('--shard=common-1');
		progress({type: 'end', id: name, ...(failed ? {failure: 'fixture assertion failed'} : {})});
		record('end');
		process.exitCode = failed ? 1 : 0;
	`;
	for (const file of ['scripts/run-lint.mjs', 'scripts/run-node-tests.mjs', 'scripts/compact-v8-coverage.mjs',
		'scripts/report-local-node-coverage.mjs', 'fake-npm.mjs', 'node_modules/@playwright/test/cli.js']) {
		await writeFile(join(fixture, file), stub);
	}
	await writeFile(join(fixture, 'scripts/check-all-browser-servers.ts'), `
		console.log('SCAPE_CHECK_ALL ' + JSON.stringify({type: 'start', id: 'servers-ready', label: 'fixture previews'}));
		setInterval(() => {}, 1000);
	`);
	const env: NodeJS.ProcessEnv = { ...process.env, npm_execpath: join(fixture, 'fake-npm.mjs') };
	delete env.NODE_TEST_CONTEXT;
	delete env.NODE_V8_COVERAGE;
	async function run(fail: boolean): Promise<{ code: number | null; output: string }> {
		await rm(join(fixture, 'first-wave-ready'), { recursive: true, force: true });
		await mkdir(join(fixture, 'first-wave-ready'));
		let output = '';
		const child = spawn(process.execPath, ['scripts/check-all.ts'], { cwd: fixture, env: { ...env, FIXTURE_FAIL: fail ? '1' : '0' }, stdio: ['ignore', 'pipe', 'pipe'] });
		context.after(() => { child.kill('SIGINT'); });
		child.stdout.on('data', (chunk: Buffer) => { output += chunk.toString(); });
		child.stderr.on('data', (chunk: Buffer) => { output += chunk.toString(); });
		const code = await new Promise<number | null>((resolveExit, reject) => { child.once('error', reject); child.once('close', resolveExit); });
		return { code, output };
	}
	const { code, output } = await run(true);
	assert.equal(code, 1, output);
	assert.match(output, /fixture assertion failed/u);
	assert.match(output, /coverage \(blocked\)/u);
	assert.match(output, /30\/30/u);
	assert.doesNotMatch(output, /passing-result-noise|All checks passed/u);
	assert.match(output, /^node\/common-1: Error: expected stdout diagnostic$/mu);
	assert.match(output, /^node\/common-1: Error: expected stderr diagnostic$/mu);
	assert.doesNotMatch(output, /^FAIL .*expected (?:stdout|stderr) diagnostic/mu);
	await assert.rejects(readFile(join(fixture, '.wrangler/check-all.lock')), { code: 'ENOENT' });
	assert.match(await readFile(join(fixture, 'test-results/check-all/logs/node-common-1.log'), 'utf8'), /passing-result-noise/u);
	const activity = (await readFile(join(fixture, 'activity.jsonl'), 'utf8')).trim().split('\n').map(line => JSON.parse(line) as { type: string; name: string });
	assert.ok(activity.some(event => event.type === 'start' && event.name.includes('--shard=lightscaper')), 'Lightscaper remains an independently executed fixture shard');
	const active = new Set<string>();
	let maximum = 0;
	for (const event of activity) {
		if (event.type === 'start') active.add(event.name);
		else active.delete(event.name);
		maximum = Math.max(maximum, active.size);
	}
	assert.equal(active.size, 0);
	assert.equal(maximum, 4);
	assert.equal(activity.filter(event => event.type === 'start' && event.name.startsWith('cli.js:')).length, 4);
	assert.equal(activity.filter(event => event.type === 'start' && event.name.startsWith('report-local')).length, 0);
	await writeFile(join(fixture, 'activity.jsonl'), '');
	const passed = await run(false);
	assert.equal(passed.code, 0, passed.output);
	assert.match(passed.output, /All checks passed/u);
	assert.doesNotMatch(passed.output, /passing-result-noise|^FAIL /mu);
	const successful = (await readFile(join(fixture, 'activity.jsonl'), 'utf8')).trim().split('\n').map(line => JSON.parse(line) as { type: string; name: string });
	const reportStart = successful.findIndex(event => event.type === 'start' && event.name.startsWith('report-local'));
	assert.ok(reportStart >= 0);
	assert.equal(successful.slice(0, reportStart).filter(event => event.type === 'end' && event.name.startsWith('compact-v8')).length, 5);
	await assert.rejects(readFile(join(fixture, '.wrangler/check-all.lock')), { code: 'ENOENT' });
});
