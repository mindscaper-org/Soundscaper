/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { access } from 'node:fs/promises';
import { resolve } from 'node:path';
import { setTimeout } from 'node:timers/promises';
import test from 'node:test';

import { limitedProcessArguments, startLimitedProcess } from '../scripts/lib/check-all-process.ts';

const root = new URL('../', import.meta.url).pathname.replace(/\/$/u, '');

test('check-all caps the whole scope at 8 GiB, disables swap and preserves literal arguments', () => {
	const args = limitedProcessArguments(root, 'example.scope', ['-e', 'console.log("$HOME")']);
	assert.ok(args.includes('--property=MemoryMax=8589934592'));
	assert.ok(args.includes('--property=MemorySwapMax=0'));
	assert.ok(args.includes('--scope'));
	assert.ok(args.includes('--user'));
	assert.ok(args.includes('--expand-environment=no'));
	assert.equal(args.at(-1), 'console.log("$HOME")');
});

let supported = process.platform === 'linux';
if (supported) {
	try { execFileSync('systemd-run', ['--user', '--scope', '--quiet', '--property=MemoryMax=8G', '--property=MemorySwapMax=0', '/usr/bin/true'], { stdio: 'ignore', timeout: 5_000 }); }
	catch { supported = false; }
}

test('check-all verifies a real cgroup cap and terminates an over-budget grandchild', { skip: !supported, timeout: 15_000 }, async () => {
	let output = '';
	const run = startLimitedProcess(root, 'memory-fixture', ['-e', `
		const { spawnSync } = require('node:child_process');
		const result = spawnSync(process.execPath, ['-e', 'require("node:fs").writeSync(1, "allocating"); Buffer.alloc(1024 * 1024 * 1024, 1); console.log("allocated")'], { stdio: 'inherit' });
		process.exitCode = result.signal === 'SIGKILL' ? 1 : 0;
	`], { memoryBytes: 512 * 1024 * 1024, onOutput: chunk => { output += chunk; } });
	try {
		assert.notEqual(await run.completed, 0, `systemd must report the shard OOM even if its parent recovers: ${output}`);
		assert.match(output, /allocating/u);
		assert.doesNotMatch(output, /allocated/u);
	} finally { await run.stop(); }
});

test('check-all cancellation kills descendants and settles the running shard', { skip: !supported, timeout: 15_000 }, async () => {
	let started!: () => void;
	const ready = new Promise<void>(resolve => { started = resolve; });
	let cgroup = '';
	const run = startLimitedProcess(root, 'cancel-fixture', ['-e', `
		require('node:child_process').spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { detached: true, stdio: 'ignore' });
		console.log('ready:' + require('node:fs').readFileSync('/proc/self/cgroup', 'utf8').trim().slice(3)); setInterval(() => {}, 1000);
	`], { onOutput: chunk => {
		const path = /ready:(.+)/u.exec(chunk.toString())?.[1];
		if (path) { cgroup = resolve('/sys/fs/cgroup', '.' + path); started(); }
	} });
	try {
		await Promise.race([ready, setTimeout(5_000, undefined, { ref: false }).then(() => { throw new Error('fixture did not start'); })]);
		await run.stop();
		assert.notEqual(await run.completed, 0);
		await assert.rejects(access(cgroup), { code: 'ENOENT' }, 'the detached grandchild must not retain its scope');
	} finally { await run.stop(); }
});
