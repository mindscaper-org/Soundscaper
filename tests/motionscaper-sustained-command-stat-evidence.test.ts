/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { motionSustainedCommand } from '../scripts/performance/motionscaper-sustained-command.ts';

interface Receipt {
	closureObserved: boolean; failure: string | null; cleanupErrors: string[]; survivingProcesses: unknown[];
	code: number | null; signal: string | null; signals: unknown[]; ownedProcesses: { pid: number }[];
	statFailures: { pid: number; path: string; capturedBase64: string; encoding: string; utf8ByteLength: number; sha256: string; truncated: boolean; message: string }[];
	statFailureOverflow: boolean;
}
const pid = 90000000, path = `/proc/${pid}/stat`;
function stat(group: string, session: string, name = 'parentheses ) and space'): string {
	return `${pid} (${name}) S 1 ${group} ${session} ${Array<string>(15).fill('0').join(' ')} 123\n`;
}
for (const [label, text] of [['negative group', stat('-1', '1')], ['non-numeric session', stat('1', 'bad')],
	['malformed identity', 'unparseable stat\n'], ['oversize malformed comm', stat('-1', '1', 'x'.repeat(5000))],
	['dead task with mixed released group', stat('-1', '1').replace(') S ', ') X ')],
	['dead task with invalid released IDs', stat('-2', '-1').replace(') S ', ') X ')]] as const) {
	test(`Motion failed command census retains the ${label} observation without accepting it`, async context => {
		const directory = await fs.promises.mkdtemp(join(tmpdir(), 'motion-stat-evidence-'));
		const read = fs.promises.readFile, readdir = fs.promises.readdir; let injected = 0;
		try {
			context.mock.method(fs.promises, 'readdir', async (value: fs.PathLike) => {
				const names = await readdir(value); return value === '/proc' ? [...names, String(pid)] : names;
			});
			context.mock.method(fs.promises, 'readFile', (value: fs.PathLike) => {
				if (value === path) { injected++; return Promise.resolve(text); }
				return read(value, 'utf8');
			}); syncBuiltinESMExports();
			await assert.rejects(motionSustainedCommand({ command: process.execPath, args: ['-e', 'setTimeout(()=>{},200)'],
				cwd: directory, directory, id: 'invalid', timeoutMs: 2000 }), /Qualification command failed/);
			const receipt = JSON.parse(await read(join(directory, 'invalid-command.json'), 'utf8')) as Receipt;
			assert.ok(injected > 0); assert.equal(receipt.closureObserved, true);
			assert.match(receipt.failure ?? '', /Command ownership observation failed: Error: Invalid/);
			assert.deepEqual(receipt.cleanupErrors, []); assert.deepEqual(receipt.survivingProcesses, []);
			assert.ok(Array.isArray(receipt.statFailures), 'failure receipt must retain the actual unaccepted stat');
			assert.ok(receipt.statFailures.length >= 1 && receipt.statFailures.length <= 16);
			const record = receipt.statFailures[0]!;
			assert.equal(record.pid, pid); assert.equal(record.path, path);
			assert.equal(record.utf8ByteLength, Buffer.byteLength(text));
			assert.equal(record.sha256, createHash('sha256').update(text).digest('hex'));
			assert.equal(record.truncated, Buffer.byteLength(text) > 4096);
			assert.equal(record.encoding, 'utf8-read-string');
			const captured = Buffer.from(record.capturedBase64, 'base64');
			assert.ok(captured.length <= 4096);
			assert.deepEqual(captured, Buffer.from(text, 'utf8').subarray(0, 4096));
			assert.match(record.message, /Invalid Linux process stat|Invalid command process group\/session/);
			assert.equal(receipt.statFailureOverflow, false);
		} finally {
			context.mock.restoreAll(); syncBuiltinESMExports();
			await fs.promises.rm(directory, { recursive: true, force: true });
		}
	});
}

test('Motion command census admits the captured dead foreign task without signalling or owning it', async context => {
	// Exact refused /proc record, SHA-256 4c53e71d44ae1b95b6f96387a7873399192be006e986679a7f38bc595b29fc36.
	const text = '3492764 (cmake) X 0 -1 -1 0 -1 4227084 987 6889 0 0 0 1 2 4 20 0 0 0 20003778 0 0 0 0 0 0 0 0 0 0 0 0 1 0 0 17 22 0 0 0 0 0 0 0 0 0 0 0 0 0\n';
	assert.equal(createHash('sha256').update(text).digest('hex'), '4c53e71d44ae1b95b6f96387a7873399192be006e986679a7f38bc595b29fc36');
	const foreignPid = 3492764, foreignPath = `/proc/${foreignPid}/stat`;
	const directory = await fs.promises.mkdtemp(join(tmpdir(), 'motion-dead-stat-'));
	const read = fs.promises.readFile, readdir = fs.promises.readdir; let injected = 0;
	try {
		context.mock.method(fs.promises, 'readdir', async (value: fs.PathLike) => {
			const names = await readdir(value); return value === '/proc' ? [...new Set([...names, String(foreignPid)])] : names;
		});
		context.mock.method(fs.promises, 'readFile', (value: fs.PathLike) => {
			if (value === foreignPath) { injected++; return Promise.resolve(text); }
			return read(value, 'utf8');
		}); syncBuiltinESMExports();
		const result = await motionSustainedCommand({ command: process.execPath,
			args: ['-e', 'setTimeout(()=>process.stdout.write("completed"),100)'],
			cwd: directory, directory, id: 'dead-foreign', timeoutMs: 2000 });
		const receipt = JSON.parse(await read(result.receipt.path, 'utf8')) as Receipt;
		assert.ok(injected > 0); assert.equal(result.stdout, 'completed');
		assert.equal(receipt.code, 0); assert.equal(receipt.signal, null); assert.equal(receipt.failure, null);
		assert.equal(receipt.closureObserved, true); assert.deepEqual(receipt.cleanupErrors, []);
		assert.deepEqual(receipt.survivingProcesses, []); assert.deepEqual(receipt.signals, []);
		assert.equal(receipt.ownedProcesses.some(value => value.pid === foreignPid), false);
		assert.deepEqual(receipt.statFailures, []); assert.equal(receipt.statFailureOverflow, false);
	} finally {
		context.mock.restoreAll(); syncBuiltinESMExports();
		await fs.promises.rm(directory, { recursive: true, force: true });
	}
});
