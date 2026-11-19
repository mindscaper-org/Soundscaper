/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import test, { type TestContext } from 'node:test';

import { runSessionSystemctl } from '../scripts/lib/check-all-session.ts';
import { startLimitedProcess } from '../scripts/lib/check-all-process.ts';

const skipShellFixtures = process.platform === 'win32';

async function fixture(context: TestContext) {
	const directory = await mkdtemp(join(tmpdir(), 'scape-systemctl-fixture-'));
	context.after(() => rm(directory, { recursive: true, force: true }));
	await writeFile(join(directory, 'systemctl'), `#!${process.execPath}
import { appendFileSync, writeFileSync } from 'node:fs';
const entry = { args: process.argv.slice(2), runtime: process.env.XDG_RUNTIME_DIR, address: process.env.DBUS_SESSION_BUS_ADDRESS };
appendFileSync(process.env.FIXTURE_COMMANDS, JSON.stringify(entry) + '\\n');
console.log(JSON.stringify(entry));
console.error('fixture stderr');
if (process.argv.includes('hold')) {
	writeFileSync(process.env.FIXTURE_PID, String(process.pid));
	process.on('SIGTERM', () => { setTimeout(() => { console.log('closed after signal'); process.exit(0); }, 25); });
	console.log('holding');
	setInterval(() => {}, 1000);
} else process.exitCode = Number(process.env.FIXTURE_EXIT || 0);
`, { mode: 0o755 });
	await writeFile(join(directory, 'sudo'), `#!${process.execPath}
import { spawnSync } from 'node:child_process';
console.log('sudo fixture ' + JSON.stringify(process.argv.slice(2)));
const args = process.argv.slice(process.argv.indexOf('--') + 1);
process.exitCode = spawnSync(args[0], args.slice(1), { stdio: 'inherit', env: process.env }).status;
`, { mode: 0o755 });
	const log = new PassThrough();
	let output = '';
	log.on('data', (chunk: Buffer) => { output += chunk.toString(); });
	const env = {
		...process.env, PATH: `${directory}:${process.env.PATH}`,
		XDG_RUNTIME_DIR: '/fixture/runtime', DBUS_SESSION_BUS_ADDRESS: 'unix:path=/fixture/runtime/bus',
		FIXTURE_COMMANDS: join(directory, 'commands.jsonl'), FIXTURE_PID: join(directory, 'pid'),
	};
	return { directory, env, log, output: () => output };
}

test('check-all setup runs literal systemctl arguments with the recovered environment and logs diagnostics', { skip: skipShellFixtures }, async context => {
	const f = await fixture(context);
	const result = await runSessionSystemctl(['set-property', 'example.service', 'Delegate=cpu memory', '$HOME'], {
		env: { ...f.env, FIXTURE_EXIT: '7' }, uid: 1000, privileged: false, log: f.log,
	});
	assert.equal(result.code, 7);
	assert.match(result.output, /fixture stderr/u);
	const entry = JSON.parse((await readFile(f.env.FIXTURE_COMMANDS, 'utf8')).trim()) as { args: string[]; runtime: string; address: string };
	assert.deepEqual(entry.args, ['set-property', 'example.service', 'Delegate=cpu memory', '$HOME']);
	assert.equal(entry.runtime, f.env.XDG_RUNTIME_DIR);
	assert.equal(entry.address, f.env.DBUS_SESSION_BUS_ADDRESS);
	assert.match(f.output(), /fixture stderr/u);
});

test('check-all setup uses sudo only for privileged operations and avoids password prompts without a terminal', { skip: skipShellFixtures }, async context => {
	const f = await fixture(context);
	for (const interactive of [true, false]) {
		const result = await runSessionSystemctl(['start', 'user@1000.service'], { env: f.env, uid: 1000, privileged: true, interactive });
		assert.equal(result.code, 0);
		const firstLine = result.output.split('\n')[0];
		assert.equal(firstLine, 'sudo fixture ' + JSON.stringify([...(interactive ? [] : ['--non-interactive']), '--', 'systemctl', 'start', 'user@1000.service']));
	}
	const result = await runSessionSystemctl(['start', 'user@0.service'], { env: f.env, uid: 0, privileged: true });
	assert.equal(result.code, 0);
	assert.doesNotMatch(result.output, /sudo fixture/u);
});

test('check-all session cancellation waits for the setup process to close before ending its log', { skip: skipShellFixtures, timeout: 5_000 }, async context => {
	const f = await fixture(context);
	const controller = new AbortController();
	f.log.on('data', (chunk: Buffer) => { if (chunk.toString().includes('holding')) controller.abort(); });
	await assert.rejects(runSessionSystemctl(['hold'], { env: f.env, uid: 1000, privileged: false, signal: controller.signal, log: f.log }), { name: 'AbortError' });
	f.log.end();
	const pid = Number(await readFile(f.env.FIXTURE_PID, 'utf8'));
	context.after(() => { try { process.kill(pid, 'SIGKILL'); } catch { /* Already closed. */ } });
	assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
	assert.match(f.output(), /closed after signal/u);
});

test('check-all kills and stops scopes using the same recovered session environment as their launcher', { skip: process.platform !== 'linux' }, async context => {
	const f = await fixture(context);
	await writeFile(join(f.directory, 'systemd-run'), `#!${process.execPath}\nconsole.log('fixture limited process');\n`, { mode: 0o755 });
	const child = startLimitedProcess(f.directory, 'environment-fixture', ['-e', ''], { env: f.env });
	try { assert.equal(await child.completed, 0); }
	finally { await child.stop(); }
	const commands = (await readFile(f.env.FIXTURE_COMMANDS, 'utf8')).trim().split('\n').map(line => JSON.parse(line) as { args: string[]; runtime: string; address: string });
	assert.deepEqual(commands.map(command => command.args.slice(0, 2)), [['--user', 'kill'], ['--user', 'stop']]);
	for (const command of commands) {
		assert.equal(command.runtime, f.env.XDG_RUNTIME_DIR);
		assert.equal(command.address, f.env.DBUS_SESSION_BUS_ADDRESS);
	}
});
