/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import type { NativePreviewCloseLatchInputCurrentV1 } from './helpers/lightscaper-native-photo-preview-close-latch-child-current.ts';
import { nativePreviewCacheFixtureCurrentV1 as fixture } from './helpers/lightscaper-native-photo-preview-cache-fixture-current.ts';
void test('Lightscaper native preview quarantines the namespace immediately after actual close refusal', { timeout: 15000 }, async context => fixture(context, async f => {
	const input: Readonly<NativePreviewCloseLatchInputCurrentV1> = { appDataPath: f.appDataPath };
	const child = spawn(process.execPath, [...process.execArgv.filter(value => !value.startsWith('--test')), fileURLToPath(new URL('./helpers/lightscaper-native-photo-preview-close-latch-child-current.ts', import.meta.url)), input.appDataPath],
		{ stdio: ['ignore', 'ignore', 'pipe'] });
	let stderr = '', timeout = false, launchError: unknown;
	child.stderr.setEncoding('utf8'); child.stderr.on('data', (value: string) => { if (stderr.length < 16384) stderr += value.slice(0, 16384 - stderr.length); });
	const done = new Promise<number | null>(resolve => { child.once('error', (error: unknown) => { launchError = error; }); child.once('close', resolve); });
	const stop = (): void => { child.kill('SIGKILL'); }, timer = setTimeout(() => { timeout = true; stop(); }, 12000);
	context.signal.addEventListener('abort', stop, { once: true });
	try { assert.equal(await done, 0, stderr); assert.equal(launchError, undefined); assert.equal(timeout, false); }
	finally { clearTimeout(timer); context.signal.removeEventListener('abort', stop); if (child.exitCode === null && child.signalCode === null) stop(); await done; }
}));
