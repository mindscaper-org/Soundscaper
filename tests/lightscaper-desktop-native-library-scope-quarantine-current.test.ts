/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import type { NativeLibraryQuarantineTerminalCurrentV1 } from './helpers/lightscaper-native-library-scope-quarantine-child-current.ts';
import { LightscaperNativePhotoLibraryScopesCurrentV1 as Scopes } from '../desktop/lightscaper-native-photo-library-scopes-current-v1.ts';

test('Lightscaper genuine cleanup quarantine fences every scope frontdoor and holds crossprocess exclusion until the owning process retires', { timeout: 30_000 }, async () => {
	const directory = await realpath(await mkdtemp(join(tmpdir(), 'lightscaper quarantined scope ')));
	const child = fork(fileURLToPath(new URL('./helpers/lightscaper-native-library-scope-quarantine-child-current.ts', import.meta.url)), [directory],
		{ execPath: process.execPath, execArgv: ['--import', import.meta.resolve('tsx')], stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
	child.stdout?.resume(); let stderr = '', ready!: (value: unknown) => void, terminal: Partial<NativeLibraryQuarantineTerminalCurrentV1> | undefined;
	child.stderr?.on('data', (bytes: Buffer) => { if (stderr.length < 16_384) stderr += bytes.toString().slice(0, 16_384 - stderr.length); });
	const readiness = new Promise<unknown>(accept => { ready = accept; });
	child.on('message', (value: unknown) => {
		if (value !== null && typeof value === 'object' && 'phase' in value) { if (value.phase === 'quarantined') ready(value); else if (value.phase === 'terminal') terminal = value as Partial<NativeLibraryQuarantineTerminalCurrentV1>; }
	});
	let childError: unknown, expired = false;
	const recordChildError = (error: unknown): void => { if (childError === undefined) childError = error; };
	// The Node test timeout does not retire a child. Own its kill deadline and
	// resolve only from actual close, including the native launch-error path.
	const deadline = setTimeout(() => {
		expired = true;
		try { if (!child.kill('SIGKILL')) recordChildError(new Error('Quarantine child deadline could not signal its owned process.')); }
		catch (error) { recordChildError(error); }
	}, 15_000);
	const closed = new Promise<Readonly<{ code: number | null; signal: NodeJS.Signals | null; error: unknown; expired: boolean }>>(accept => {
		child.on('error', recordChildError);
		child.once('close', (code, signal) => { clearTimeout(deadline); accept({ code, signal, error: childError, expired }); });
	});
	let unexpected: Scopes | undefined, failed = false, primary: unknown;
	try {
		const value = await Promise.race([readiness, closed.then(() => { throw new Error('Quarantine child closed before its bounded report.'); })]);
		assert.ok(value !== null && typeof value === 'object'); const report = value as Record<string, unknown>;
		assert.equal(report.initialized, true, stderr); assert.equal(report.injected, true); assert.equal(report.componentFailed, true);
		try { unexpected = await Scopes.open({ appDataPath: directory }); } catch { /* Actual child guard must still exclude this process. */ }
		assert.equal(unexpected, undefined, 'Quarantined child must keep its actual native guard.');
		assert.ok(Array.isArray(report.refused)); assert.equal(report.refused.length, 10); assert.ok(report.refused.every(value => value === true));
		assert.equal(report.traps, 0, 'Every frontdoor must fence before reading borrowed values.');
	} catch (error) { failed = true; primary = error; }
	const cleanup: unknown[] = [];
	try { await unexpected?.close(); } catch (error) { cleanup.push(error); }
	try { if (child.connected) child.send('release', error => { if (error) recordChildError(error); }); }
	catch (error) { recordChildError(error); }
	// Never reject from a launch error, failed send or kill request before
	// joining the actual close event. Cleanup/reopen stays below this join.
	const result = await closed;
	if (result.error !== undefined) cleanup.push(result.error);
	if (result.expired) cleanup.push(new Error('Quarantine child exceeded its owned fifteen-second deadline.'));
	if (result.code !== 0 || result.signal !== null) cleanup.push(new Error(`Quarantine child did not exit naturally: code=${result.code}, signal=${result.signal}. ${stderr}`));
	if (cleanup.length) throw new AggregateError([...(failed ? [primary] : []), ...cleanup], 'Quarantine child retirement or parent cleanup failed.');
	assert.ok(terminal !== null && typeof terminal === 'object' && 'closeFailed' in terminal); assert.equal(terminal.closeFailed, true);
	const reopened = await Scopes.open({ appDataPath: directory }); try { await reopened.openDefault(); } finally { await reopened.close(); }
	await rm(directory, { recursive: true, force: false }); if (failed) throw primary;
});
