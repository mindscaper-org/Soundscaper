/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { constants } from 'node:os';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { after, before, test } from 'node:test';

const execute = promisify(execFile), supported = process.platform === 'linux';
let directory = '', executable = '';
before(async () => {
	if (!supported) return;
	directory = await mkdtemp(join(tmpdir(), 'motion-darwin-census-')); executable = join(directory, 'census-fixture');
	const fixture = resolve(import.meta.dirname, 'fixtures/motionscaper-darwin-census');
	await execute('cc', ['-std=c11', '-D_GNU_SOURCE', '-Wall', '-Wextra', '-Werror', `-I${fixture}`,
		`-DMOTION_DARWIN_CONTROLLER_SOURCE=${JSON.stringify(resolve(import.meta.dirname, '../scripts/lib/motionscaper-qualification-process-darwin.c'))}`,
		join(fixture, 'census-driver.c'), '-o', executable], { timeout: 30000, maxBuffer: 65536 });
});
after(async () => { if (directory) await rm(directory, { recursive: true, force: true }); });
async function observe(scenario: string, action: 'session' | 'snapshot') {
	try { const result = await execute(executable, [scenario, action], { timeout: 5000, maxBuffer: 65536 }); return { code: 0, ...result }; }
	catch (error) {
		assert.ok(error && typeof error === 'object');
		const code: unknown = Reflect.get(error, 'code'); assert.equal(typeof code, 'number');
		return { code, stdout: String(Reflect.get(error, 'stdout')), stderr: String(Reflect.get(error, 'stderr')) };
	}
}

// This executes the real controller's admission branches with a Linux libproc shim, not macOS qualification.
for (const [scenario, expected] of [['permission', constants.errno.EACCES], ['zero', constants.errno.EIO],
	['negative', constants.errno.EIO], ['overflow', constants.errno.EOVERFLOW]] as const) {
	test(`Darwin controller refuses ${scenario} census for session cleanup`, { skip: !supported }, async () => {
		const session = await observe(scenario, 'session'); assert.equal(session.code, 0);
		assert.deepEqual(JSON.parse(session.stdout) as unknown, { result: -1, errno: expected });
	});
	test(`Darwin controller refuses ${scenario} census for public snapshot`, { skip: !supported }, async () => {
		const snapshot = await observe(scenario, 'snapshot'); assert.equal(snapshot.code, 125);
		assert.equal(snapshot.stdout, '', 'Failed observation must not publish an empty successful snapshot.');
	});
}
test('Darwin controller distinguishes a valid self-only census from observation failure', { skip: !supported }, async () => {
	const session = await observe('self', 'session'); assert.equal(session.code, 0);
	assert.deepEqual(JSON.parse(session.stdout) as unknown, { result: 0, errno: 0 });
	const snapshot = await observe('self', 'snapshot'); assert.equal(snapshot.code, 0);
	const value = JSON.parse(snapshot.stdout) as { processes: readonly { platform: string; pid: number }[]; visibilityGaps: number };
	assert.equal(value.processes.length, 1); assert.equal(value.processes[0]?.platform, 'darwin');
	assert.ok(value.processes[0]!.pid > 0); assert.equal(value.visibilityGaps, 0);
});
