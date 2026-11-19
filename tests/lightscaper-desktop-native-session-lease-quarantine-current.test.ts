/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { LightscaperNativePhotoLibraryScopesCurrentV1 as Scopes } from '../desktop/lightscaper-native-photo-library-scopes-current-v1.ts';
import type { NativeSessionLeaseQuarantineTerminalCurrentV1 } from './helpers/lightscaper-native-session-lease-quarantine-child-current.ts';

void test('Native selected local cleanup failure fences the manager and retains actual crossprocess guard until its joined process exit', { timeout: 30_000 }, async context => {
	const directory = await realpath(await mkdtemp(join(tmpdir(), 'lightscaper selected lease quarantine ')));
	const child = fork(fileURLToPath(new URL('./helpers/lightscaper-native-session-lease-quarantine-child-current.ts', import.meta.url)), [directory],
		{ execPath: process.execPath, execArgv: ['--import', import.meta.resolve('tsx')], stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
	child.stdout?.resume(); let stderr = '', ready!: (value: unknown) => void, terminal: Partial<NativeSessionLeaseQuarantineTerminalCurrentV1> | undefined;
	const readiness = new Promise<unknown>(resolve => { ready = resolve; }); let childError: unknown, expired = false;
	const record = (error: unknown): void => { if (childError === undefined) childError = error; };
	child.stderr?.on('data', (bytes: Buffer) => { if (stderr.length < 16_384) stderr += bytes.toString().slice(0, 16_384 - stderr.length); });
	child.on('message', (value: unknown) => {
		if (value !== null && typeof value === 'object' && 'phase' in value) {
			if (value.phase === 'quarantined') ready(value);
			else if (value.phase === 'terminal') terminal = value as Partial<NativeSessionLeaseQuarantineTerminalCurrentV1>;
		}
	});
	const kill = (): void => {
		expired = true; try { if (!child.kill('SIGKILL')) record(new Error('Owned selected lease child could not be signaled.')); } catch (error) { record(error); }
	};
	const deadline = setTimeout(kill, 15_000); context.signal.addEventListener('abort', kill, { once: true });
	if (context.signal.aborted) kill();
	const closed = new Promise<Readonly<{ code: number | null; signal: NodeJS.Signals | null }>>(resolve => {
		child.on('error', record); child.once('close', (code, signal) => { clearTimeout(deadline); context.signal.removeEventListener('abort', kill); resolve({ code, signal }); });
	});
	let unexpected: Scopes | undefined, failed = false, primary: unknown;
	try {
		const value = await Promise.race([readiness, closed.then(() => { throw new Error('Selected lease child closed before bounded quarantine receipt.'); })]);
		assert.ok(value !== null && typeof value === 'object'); const report = value as Record<string, unknown>;
		for (const key of ['initialized', 'bodyMatched', 'consumerJoined', 'closeFailed', 'cached']) assert.equal(report[key], true, `${key}: ${stderr}`);
		assert.equal(report.localCalls, 1); assert.equal(report.traps, 0); assert.ok(Array.isArray(report.refused)); assert.equal(report.refused.length, 7); assert.ok(report.refused.every(value => value === true));
		try { unexpected = await Scopes.open({ appDataPath: directory }); } catch { /* Genuine child SQLite IMMEDIATE transaction must exclude this process. */ }
		assert.equal(unexpected, undefined, 'Unknown local retirement cannot release the actual writer guard.');
	} catch (error) { failed = true; primary = error; }
	const cleanup: unknown[] = [];
	try { await unexpected?.close(); } catch (error) { cleanup.push(error); }
	try { if (child.connected) child.send('release', error => { if (error) record(error); }); } catch (error) { record(error); }
	// Even launch/send/kill errors cannot bypass actual process close before
	// reopening the real namespace or removing this owned test directory.
	const result = await closed;
	if (childError !== undefined) cleanup.push(childError); if (expired) cleanup.push(new Error('Selected lease child exceeded its owned fifteen-second deadline.'));
	if (result.code !== 0 || result.signal !== null) cleanup.push(new Error(`Selected lease child did not exit naturally: ${result.code}/${result.signal}. ${stderr}`));
	if (cleanup.length) throw new AggregateError([...(failed ? [primary] : []), ...cleanup], 'Selected lease quarantine child did not retire.');
	assert.ok(terminal); assert.equal(terminal.managerCloseFailed, true);
	const reopened = await Scopes.open({ appDataPath: directory }); try { await reopened.openSelected({ name: 'After actual child retirement' }); } finally { await reopened.close(); }
	await rm(directory, { recursive: true, force: false }); if (failed) throw primary;
});
