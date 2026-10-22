/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { EventEmitter, once } from 'node:events';
import { copyFile, mkdtemp, open, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import test from 'node:test';

import { terminatePackagedRuntime } from './browser/helpers/packaged-runtime-process.js';
import { terminateWindowsPackagedRuntimeTree } from './browser/helpers/packaged-runtime-windows-containment.ts';

test('Windows runtime teardown contains descendants before accepting the main process exit', async () => {
	const signals: NodeJS.Signals[] = [];
	const child = Object.assign(new EventEmitter(), {
		pid: 12345,
		exitCode: null as number | null,
		signalCode: null as NodeJS.Signals | null,
		kill(signal: NodeJS.Signals = 'SIGTERM') {
			signals.push(signal);
			child.exitCode = 0;
			child.emit('exit', 0, null);
			return true;
		},
	});
	let release!: () => void;
	const treeContained = new Promise<void>((resolve) => { release = resolve; });
	const killedTrees: number[] = [];
	let settled = false;
	const teardown = terminatePackagedRuntime(child, 0, 100, {
		platform: 'win32',
		terminateWindowsTree: async (pid: number) => {
			killedTrees.push(pid);
			child.exitCode = 0;
			child.emit('exit', 0, null);
			await treeContained;
		},
	}).then(() => { settled = true; });
	try {
		await Promise.resolve();
		assert.deepEqual(killedTrees, [child.pid]);
		assert.deepEqual(signals, [], 'killing only the parent first loses the Windows process tree');
		assert.equal(settled, false, 'the main exit alone does not prove utility processes were terminated');
	} finally {
		release();
		await teardown;
	}
	assert.equal(settled, true);
});

test('Windows containment awaits the complete launched PID tree through System32 taskkill', async () => {
	const killer = Object.assign(new EventEmitter(), { kill: () => true });
	let invocation: unknown;
	let settled = false;
	const containment = terminateWindowsPackagedRuntimeTree(12345, {
		environment: { SystemRoot: 'C:\\Windows' },
		spawn: (executable, args, options) => {
			invocation = { executable, args, options };
			return killer;
		},
	}).then(() => { settled = true; });
	assert.deepEqual(invocation, {
		executable: 'C:\\Windows\\System32\\taskkill.exe', args: ['/PID', '12345', '/T', '/F'],
		options: { shell: false, windowsHide: true, stdio: 'ignore' },
	});
	assert.equal(settled, false);
	killer.emit('close', 0, null);
	await containment;
	assert.equal(settled, true);
});

test('a failed Windows tree kill remains a teardown failure even if the main process exits', async () => {
	const child = Object.assign(new EventEmitter(), {
		pid: 12345,
		exitCode: null as number | null,
		signalCode: null as NodeJS.Signals | null,
		kill() { child.exitCode = 1; child.emit('exit', 1, null); return true; },
	});
	await assert.rejects(terminatePackagedRuntime(child, 0, 100, {
		platform: 'win32',
		terminateWindowsTree: async () => { throw new Error('tree kill failed'); },
	}), /tree kill failed/u);
});

test('Windows tree containment bounds a stuck taskkill without reporting success', async () => {
	const signals: NodeJS.Signals[] = [];
	const killer = Object.assign(new EventEmitter(), { kill(signal: NodeJS.Signals) { signals.push(signal); return true; } });
	await assert.rejects(terminateWindowsPackagedRuntimeTree(12345, {
		timeoutMs: 1, environment: { SystemRoot: 'C:\\Windows' }, spawn: () => killer,
	}), /exceeded its deadline/u);
	assert.deepEqual(signals, ['SIGKILL']);
});

test('Windows runtime teardown releases the executable held by a real child process tree', {
	skip: process.platform !== 'win32', timeout: 30_000,
}, async (context) => {
	const root = await mkdtemp(join(tmpdir(), 'scape-runtime-containment-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	const executable = join(root, 'model-host.exe');
	const fixture = join(root, 'host.cjs');
	await copyFile(process.execPath, executable);
	await writeFile(fixture, `const { spawn } = require('node:child_process');
if (process.argv[2] !== 'utility') {
	const child = spawn(process.execPath, [__filename, 'utility'], { stdio: 'ignore' });
	console.log(child.pid);
}
setInterval(() => {}, 1000);\n`);
	const parent = spawn(executable, [fixture], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
	const lines = createInterface({ input: parent.stdout });
	try {
		const [value] = await once(lines, 'line', { signal: AbortSignal.timeout(10_000) }) as [string];
		const utilityPid = Number(value);
		assert.ok(Number.isSafeInteger(utilityPid) && utilityPid > 0);
		process.kill(utilityPid, 0);
		await assert.rejects(open(executable, 'r+'), 'the running fixture must reproduce the executable write lock');
		await terminatePackagedRuntime(parent);
		assert.throws(() => process.kill(utilityPid, 0), { code: 'ESRCH' });
		const writable = await open(executable, 'r+');
		await writable.close();
	} finally {
		lines.close();
		if (parent.exitCode === null && parent.signalCode === null) await terminatePackagedRuntime(parent);
	}
});
