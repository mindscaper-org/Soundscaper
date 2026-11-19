/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import type { NativeLibraryScopeProbeCurrentV1 } from './helpers/lightscaper-native-library-scope-integration-child-current.ts';
import { nativeScopeIntegrationFixtureCurrentV1 as fixture } from './helpers/lightscaper-native-library-scope-integration-fixture-current.ts';

async function childProbe(directory: string): Promise<Readonly<NativeLibraryScopeProbeCurrentV1>> {
	const child = fork(fileURLToPath(new URL('./helpers/lightscaper-native-library-scope-integration-child-current.ts', import.meta.url)), [directory],
		{ execPath: process.execPath, execArgv: ['--import', import.meta.resolve('tsx')], stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
	let value: unknown, stderr = ''; child.stdout?.resume();
	child.stderr?.on('data', (bytes: Buffer) => { if (stderr.length < 16_384) stderr += bytes.toString().slice(0, 16_384 - stderr.length); });
	child.on('message', (message: unknown) => { value = message; });
	const deadline = setTimeout(() => { child.kill('SIGKILL'); }, 15_000);
	const result = await new Promise<Readonly<{ code: number | null; signal: NodeJS.Signals | null; error: unknown }>>(resolve => {
		let failure: unknown;
		child.once('error', error => { failure = error; });
		child.once('close', (code, signal) => { clearTimeout(deadline); resolve({ code, signal, error: failure }); });
	});
	assert.equal(result.error, undefined);
	assert.equal(result.code, 0, stderr); assert.equal(result.signal, null);
	assert.ok(value !== null && typeof value === 'object'); assert.deepEqual(Reflect.ownKeys(value).sort(), ['opened', 'retired']);
	const report = value as Record<string, unknown>; assert.equal(typeof report.opened, 'boolean'); assert.equal(report.retired, true);
	return { opened: report.opened as boolean, retired: true };
}

test('Lightscaper actual public scope owner excludes another native Node process until parent components and global guard retire', async () => {
	await fixture(async f => {
		const scope = await f.scopes.openDefault(); await f.scopes.openComponents(scope);
		assert.equal((await childProbe(f.directory)).opened, false);
		await f.scopes.close(); assert.equal((await childProbe(f.directory)).opened, true);
		const reopened = await f.reopen(); await reopened.openComponents(await reopened.openDefault());
	});
});
