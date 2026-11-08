/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { LightscaperNativePhotoLibraryScopesCurrentV1 as Scopes } from '../desktop/lightscaper-native-photo-library-scopes-current-v1.ts';
import type { LightscaperNativeCatalogRestoreSealedReportCurrentV1 as SealedReport } from './helpers/lightscaper-native-catalog-restore-sealed-child-current.ts';

void test('Lightscaper sealed native restore rejects independent same-revision corruption and retains exclusion until actual child retirement', { timeout: 15_000 }, async context => {
	const directory = await realpath(await mkdtemp(join(tmpdir(), 'lightscaper sealed catalog child ')));
	const child = fork(fileURLToPath(new URL('./helpers/lightscaper-native-catalog-restore-sealed-child-current.ts', import.meta.url)), [directory],
		{ execPath: process.execPath, execArgv: ['--import', import.meta.resolve('tsx')], stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
	child.stdout?.resume(); let stderr = '', childError: unknown, expired = false, sealed!: (value: unknown) => void, terminal: unknown;
	child.stderr?.on('data', (bytes: Buffer) => { if (stderr.length < 16_384) stderr += bytes.toString().slice(0, 16_384 - stderr.length); });
	const ready = new Promise<unknown>(resolve => { sealed = resolve; });
	child.on('message', (value: unknown) => { if (value !== null && typeof value === 'object' && 'phase' in value) {
		if (value.phase === 'sealed') sealed(value); else if (value.phase === 'terminal') terminal = value;
	} });
	const recordError = (error: unknown): void => { childError ??= error; };
	const kill = (): void => { expired = true; try { if (!child.kill('SIGKILL')) recordError(new Error('Owned sealed child could not be signaled.')); } catch (error) { recordError(error); } };
	const deadline = setTimeout(kill, 12_000);
	const closed = new Promise<Readonly<{ code: number | null; signal: NodeJS.Signals | null }>>(resolve => {
		child.on('error', recordError); child.once('close', (code, signal) => { clearTimeout(deadline); resolve({ code, signal }); });
	});
	context.signal.addEventListener('abort', kill, { once: true }); if (context.signal.aborted) kill();
	let failed = false, primary: unknown, unexpected: Scopes | undefined;
	try {
		const value = await Promise.race([ready, closed.then(() => { throw new Error(`Owned sealed child closed before its report. ${stderr}`); })]);
		assert.ok(value !== null && typeof value === 'object'); const report = value as Readonly<Record<keyof SealedReport, unknown>>;
		for (const key of ['initialized', 'photoRefused', 'pageRefused', 'stageCloseFailed', 'candidateCloseFailed'] as const) assert.equal(report[key], true, key);
		try { unexpected = await Scopes.open({ appDataPath: directory }); } catch { /* The actual quarantined child must still own exclusion. */ }
		assert.equal(unexpected, undefined, 'Actual child guard remains held after unproved catalog retirement.');
	} catch (error) { failed = true; primary = error; }
	const cleanup: unknown[] = [];
	try { await unexpected?.close(); } catch (error) { cleanup.push(error); }
	try { if (child.connected) child.send('release', error => { if (error) recordError(error); }); } catch (error) { recordError(error); }
	const result = await closed; context.signal.removeEventListener('abort', kill);
	if (childError !== undefined) cleanup.push(childError); if (expired) cleanup.push(new Error('Owned sealed child exceeded its actual retirement deadline.'));
	if (result.code !== 0 || result.signal !== null) cleanup.push(new Error(`Owned sealed child did not retire naturally: ${String(result.code)} ${String(result.signal)} ${stderr}`));
	if (cleanup.length) throw new AggregateError([...(failed ? [primary] : []), ...cleanup], 'Sealed child retirement failed; files retained.');
	assert.ok(terminal !== null && typeof terminal === 'object' && 'ownerCloseFailed' in terminal); assert.equal(terminal.ownerCloseFailed, true);
	const reopened = await Scopes.open({ appDataPath: directory }); await reopened.close(); await rm(directory, { recursive: true, force: false }); if (failed) throw primary;
});
