/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

const root = resolve(import.meta.dirname, '..');
let supported = process.platform === 'linux';
let setupSupported = false;
if (supported) {
	try { setupSupported = readFileSync('/proc/1/comm', 'utf8').trim() === 'systemd' && /\bmemory\b/u.test(readFileSync('/sys/fs/cgroup/cgroup.controllers', 'utf8')); }
	catch { /* Boot prerequisites are tested with an injected host elsewhere. */ }
	try { execFileSync('systemd-run', ['--user', '--scope', '--quiet', '--property=MemoryMax=8G', '--property=MemorySwapMax=0', '/usr/bin/true'], { stdio: 'ignore', timeout: 5_000 }); }
	catch { supported = false; }
}

for (const runtime of ['fixture', 'systemd'] as const) test(`check-all command schedules fixture jobs, reports failures, waits for fresh coverage and cleans up (${runtime})`, { skip: runtime === 'fixture' ? !setupSupported : !supported, timeout: 30_000 }, async context => {
	const fixture = await mkdtemp(join(tmpdir(), 'scape-check-all-command-'));
	context.after(() => rm(fixture, { recursive: true, force: true }));
	await mkdir(join(fixture, 'scripts/lib'), { recursive: true });
	await mkdir(join(fixture, 'node_modules/@playwright/test'), { recursive: true });
	for (const file of ['check-all.ts', 'check-all-task.ts',
		'lib/check-all-plan.ts', 'lib/check-all-scheduler.ts', 'lib/check-all-process.ts', 'lib/check-all-session.ts', 'lib/check-all-output.ts', 'lib/check-all-logs.ts',
		'lib/lint-shards.mjs', 'lib/node-test-shards.mjs']) {
		await cp(join(root, 'scripts', file), join(fixture, 'scripts', file));
	}
	await writeFile(join(fixture, 'package.json'), JSON.stringify({ type: 'module', scripts: {
		'check:static': 'npm run lint && npm run typecheck && npm run check:architecture && npm run audit:ci && npm run build',
		typecheck: 'npm run typecheck:sources && npm run typecheck:tests',
	} }));
	const stub = `
		import {appendFileSync, readFileSync} from 'node:fs';
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
		if (process.env.FIXTURE_HOLD === '1') await new Promise(() => { setInterval(() => {}, 1000); });
		// Hold the first wave until all four jobs start, even on a busy runner.
		const deadline = Date.now() + 10_000;
		while (readFileSync('activity.jsonl', 'utf8').trim().split('\\n').length < 4) {
			if (Date.now() >= deadline) throw new Error('Timed out waiting for four fixture jobs to start.');
			await setTimeout(10);
		}
		const failed = process.env.FIXTURE_FAIL === '1' && process.argv.includes('--module-shard=common-1');
		progress({type: 'end', id: name, ...(failed ? {failure: 'fixture assertion failed'} : {})});
		record('end');
		process.exitCode = failed ? 1 : 0;
	`;
	for (const file of ['scripts/run-lint.mjs', 'scripts/run-node-tests.mjs', 'scripts/compact-v8-coverage.mjs',
		'scripts/report-local-node-coverage.mjs', 'scripts/run-module-browser-tests.ts', 'fake-npm.mjs', 'node_modules/@playwright/test/cli.js']) {
		await writeFile(join(fixture, file), stub);
	}
	await writeFile(join(fixture, 'scripts/check-all-browser-servers.ts'), `
		console.log('SCAPE_CHECK_ALL ' + JSON.stringify({type: 'start', id: 'servers-ready', label: 'fixture previews'}));
		setInterval(() => {}, 1000);
	`);
	const env: NodeJS.ProcessEnv = { ...process.env, npm_execpath: join(fixture, 'fake-npm.mjs') };
	delete env.NODE_TEST_CONTEXT;
	delete env.NODE_V8_COVERAGE;
	if (runtime === 'fixture') {
		await mkdir(join(fixture, 'bin'));
		env.PATH = `${join(fixture, 'bin')}:${env.PATH}`;
		env.XDG_RUNTIME_DIR = '/stale/runtime';
		env.DBUS_SESSION_BUS_ADDRESS = 'unix:path=/stale/bus';
		// Exercise coordinator setup and all its fixture jobs without changing the
		// host's services or running any repository checks. The real runtime above
		// and check-all-process.test.ts retain actual cgroup verification coverage.
		const prelude = `#!${process.execPath}
			import { existsSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs';
			import { spawn } from 'node:child_process';
			const canonical = process.env.XDG_RUNTIME_DIR === '/run/user/' + process.getuid()
				&& process.env.DBUS_SESSION_BUS_ADDRESS === 'unix:path=/run/user/' + process.getuid() + '/bus';
			const run = args => { const child = spawn(args[0], args.slice(1), {stdio: 'inherit'}); child.once('exit', code => { process.exitCode = code ?? 1; }); };
		`;
		await writeFile(join(fixture, 'bin/systemd-run'), `${prelude}
			if (!canonical || !existsSync('manager-active')) { console.error('fixture bus missing'); process.exit(1); }
			writeFileSync(process.argv.find(arg => arg.startsWith('--unit=')).slice(7), String(process.pid));
			run(process.argv.slice(process.argv.indexOf('--') + 1));
		`, { mode: 0o755 });
		await writeFile(join(fixture, 'bin/systemctl'), `${prelude}
			const args = process.argv.slice(2);
			if (!canonical) throw new Error('fixture setup/cleanup used the stale session environment');
			if (args.includes('show')) console.log('Delegate=yes\\nActiveState=' + (existsSync('manager-active') ? 'active' : 'inactive') + '\\nDelegateControllers=' + (existsSync('memory-delegated') ? 'cpu memory pids' : 'cpu pids'));
			else if (args.includes('set-property')) {
				if (!args.includes('Delegate=cpu pids memory') || !args.includes('--runtime')) throw new Error('fixture memory delegation must preserve controllers and be temporary');
				writeFileSync('memory-delegated', 'yes');
			} else if (args.includes('start')) writeFileSync('manager-active', 'yes');
			else if (args.includes('kill') && existsSync(args.at(-1))) { try { process.kill(-Number(readFileSync(args.at(-1), 'utf8')), 'SIGKILL'); } catch {} }
			if (!args.includes('--user')) appendFileSync('session-commands.jsonl', JSON.stringify(args) + '\\n');
		`, { mode: 0o755 });
		await writeFile(join(fixture, 'bin/sudo'), `${prelude}
			run(process.argv.slice(process.argv.indexOf('--') + 1));
		`, { mode: 0o755 });
		await writeFile(join(fixture, 'scripts/check-all-task.ts'), `
			import { existsSync } from 'node:fs';
			import { spawn } from 'node:child_process';
			if (process.argv[2] !== '8589934592' || !existsSync('memory-delegated')) throw new Error('fixture memory cap not set');
			const child = spawn(process.execPath, process.argv.slice(3), { stdio: 'inherit' });
			child.once('exit', code => { process.exitCode = code ?? 1; });
		`);
	}
	async function run(fail: boolean, interrupt = false): Promise<{ code: number | null; output: string }> {
		let output = '';
		let started!: () => void;
		const ready = new Promise<void>(resolveReady => { started = resolveReady; });
		const child = spawn(process.execPath, ['scripts/check-all.ts'], { cwd: fixture, env: { ...env, FIXTURE_FAIL: fail ? '1' : '0', FIXTURE_HOLD: interrupt ? '1' : '0' }, stdio: ['ignore', 'pipe', 'pipe'] });
		context.after(() => { child.kill('SIGINT'); });
		child.stdout.on('data', (chunk: Buffer) => {
			output += chunk.toString();
			if (output.includes('prepare/interchange: Error: expected stderr diagnostic')) started();
		});
		child.stderr.on('data', (chunk: Buffer) => { output += chunk.toString(); });
		const completed = new Promise<number | null>((resolveExit, reject) => { child.once('error', reject); child.once('close', resolveExit); });
		if (interrupt) {
			await Promise.race([ready, completed.then(() => { throw new Error(`Fixture exited before live logs were checked: ${output}`); })]);
			assert.match(await readFile(join(fixture, 'test-results/check-all/logs/prepare-interchange.log'), 'utf8'), /passing-result-noise/u);
			assert.match(await readFile(join(fixture, 'test-results/check-all/run.log'), 'utf8'), /prepare\/interchange: Error: expected stderr diagnostic/u);
			child.kill('SIGINT');
		}
		const code = await completed;
		return { code, output };
	}
	const { code, output } = await run(true);
	assert.equal(code, 1, output);
	assert.match(output, /fixture assertion failed/u);
	assert.match(output, /coverage \(blocked\)/u);
	assert.match(output, /27\/27/u);
	assert.doesNotMatch(output, /passing-result-noise|All checks passed/u);
	assert.match(output, /^node\/common-1: Error: expected stdout diagnostic$/mu);
	assert.match(output, /^node\/common-1: Error: expected stderr diagnostic$/mu);
	assert.doesNotMatch(output, /^FAIL .*expected (?:stdout|stderr) diagnostic/mu);
	await assert.rejects(readFile(join(fixture, '.wrangler/check-all.lock')), { code: 'ENOENT' });
	assert.match(await readFile(join(fixture, 'test-results/check-all/logs/node-common-1.log'), 'utf8'), /passing-result-noise/u);
	assert.match(await readFile(join(fixture, 'test-results/check-all/run.log'), 'utf8'), /FAIL node\/common-1: fixture assertion failed/u);
	assert.match(await readFile(join(fixture, 'test-results/check-all/logs/browser-previews.log'), 'utf8'), /servers-ready/u);
	if (runtime === 'fixture') {
		assert.match(output, /Starting the systemd user manager/u);
		assert.match(await readFile(join(fixture, 'test-results/check-all/logs/session-setup.log'), 'utf8'), /set-property/u);
		const commands = (await readFile(join(fixture, 'session-commands.jsonl'), 'utf8')).trim().split('\n').map(line => JSON.parse(line) as string[]);
		assert.deepEqual(commands.map(args => args[0]), ['show', 'set-property', 'start']);
	}
	const activity = (await readFile(join(fixture, 'activity.jsonl'), 'utf8')).trim().split('\n').map(line => JSON.parse(line) as { type: string; name: string });
	const active = new Set<string>();
	let maximum = 0;
	for (const event of activity) {
		if (event.type === 'start') active.add(event.name);
		else active.delete(event.name);
		maximum = Math.max(maximum, active.size);
	}
	assert.equal(active.size, 0);
	assert.equal(maximum, 4);
	assert.equal(activity.filter(event => event.type === 'start' && event.name.startsWith('run-module-browser-tests.ts:')).length, 4);
	assert.equal(activity.filter(event => event.type === 'start' && event.name.startsWith('report-local')).length, 0);
	await writeFile(join(fixture, 'activity.jsonl'), '');
	const passed = await run(false);
	assert.equal(passed.code, 0, passed.output);
	assert.match(passed.output, /All checks passed/u);
	assert.doesNotMatch(passed.output, /passing-result-noise|^FAIL /mu);
	const successful = (await readFile(join(fixture, 'activity.jsonl'), 'utf8')).trim().split('\n').map(line => JSON.parse(line) as { type: string; name: string });
	const reportStart = successful.findIndex(event => event.type === 'start' && event.name.startsWith('report-local'));
	assert.ok(reportStart >= 0);
	assert.equal(successful.slice(0, reportStart).filter(event => event.type === 'end' && event.name.startsWith('compact-v8')).length, 4);
	await assert.rejects(readFile(join(fixture, '.wrangler/check-all.lock')), { code: 'ENOENT' });
	const interrupted = await run(false, true);
	assert.equal(interrupted.code, 130, interrupted.output);
	assert.match(await readFile(join(fixture, 'test-results/check-all/run.log'), 'utf8'), /interrupted/u);
	assert.match(await readFile(join(fixture, 'test-results/check-all/logs/prepare-interchange.log'), 'utf8'), /passing-result-noise/u);
	await assert.rejects(readFile(join(fixture, '.wrangler/check-all.lock')), { code: 'ENOENT' });
	const taskScript = join(fixture, 'scripts/check-all-task.ts');
	await writeFile(taskScript, `if (process.argv.at(-2) === '-e') throw new Error('fixture memory probe rejected');\n${await readFile(taskScript, 'utf8')}`);
	const rejected = await run(false);
	assert.equal(rejected.code, 1, rejected.output);
	assert.match(await readFile(join(fixture, 'test-results/check-all/run.log'), 'utf8'), /FAIL setup:.*Cannot enforce the 8 GiB shard limit/u);
	assert.match(await readFile(join(fixture, 'test-results/check-all/logs/probe.log'), 'utf8'), /fixture memory probe rejected/u);
	await assert.rejects(readFile(join(fixture, '.wrangler/check-all.lock')), { code: 'ENOENT' });
});
