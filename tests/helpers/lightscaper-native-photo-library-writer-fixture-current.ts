/* SPDX-License-Identifier: AGPL-3.0-only */

import { fork, type ChildProcess } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deferred } from './async-test-control.ts';

import type { NativeLibraryWriterPacketCurrentV1 as Packet } from './lightscaper-native-photo-library-writer-child-current.ts';
export interface NativeGuardChildCurrentV1 {
	readonly child: ChildProcess; readonly first: Promise<Packet>; readonly closed: Promise<Readonly<{ code: number | null; signal: NodeJS.Signals | null }>>;
	release(): void;
}
export interface NativeGuardFixtureCurrentV1 {
	readonly appDataPath: string; readonly libraryRoot: string; readonly databasePath: string;
	child(): NativeGuardChildCurrentV1;
	own<T extends { close(): Promise<void> }>(owner: T): T;
}
export async function nativeGuardFixtureCurrentV1(run: (f: NativeGuardFixtureCurrentV1) => Promise<void>): Promise<void> {
	const appDataPath = await mkdtemp(join(tmpdir(), 'lightscaper native library guard '));
	const children: NativeGuardChildCurrentV1[] = [], owners: Array<{ close(): Promise<void> }> = [];
	const libraryRoot = join(appDataPath, 'Lightscaper', 'project-library', 'v1');
	let failed = false, primary: unknown;
	try { await run({ appDataPath, libraryRoot, databasePath: join(libraryRoot, 'native-photo-library-writer.sqlite3'),
		child() { const launched = launch(appDataPath); children.push(launched); return launched; },
		own(value) { owners.push(value); return value; } }); }
	catch (error) { failed = true; primary = error; }
	// Every owned independent Node process closes its pipes before any root removal.
	for (const launched of children) if (launched.child.exitCode === null && launched.child.signalCode === null) launched.child.kill('SIGKILL');
	const joined = await Promise.allSettled([...children.map(launched => launched.closed), ...owners.map(owner => owner.close())]);
	const cleanup = joined.flatMap(result => result.status === 'rejected' ? [result.reason as unknown] : []);
	if (cleanup.length) throw new AggregateError([...(failed ? [primary] : []), ...cleanup], 'Native writer test root retained after unproved retirement.');
	await rm(appDataPath, { recursive: true, force: true }); if (failed) throw primary;
}
function launch(appDataPath: string): NativeGuardChildCurrentV1 {
	const child = fork(fileURLToPath(new URL('./lightscaper-native-photo-library-writer-child-current.ts', import.meta.url)), [appDataPath],
		{ execPath: process.execPath, execArgv: ['--max-old-space-size=128', '--import', 'tsx'], stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
	const first = deferred<Packet>(), closed = deferred<Readonly<{ code: number | null; signal: NodeJS.Signals | null }>>();
	let output = '', received = false;
	const deadline = setTimeout(() => { first.reject(new Error('Native guard child exceeded its owned deadline.')); child.kill('SIGKILL'); }, 15_000);
	child.stderr!.on('data', (bytes: Buffer) => { output = (output + bytes.toString()).slice(-32_768); });
	child.on('message', (value: unknown) => {
		if (!value || typeof value !== 'object' || !('status' in value) || !['held', 'released', 'failed'].includes(String(value.status))) return;
		if (!received) { received = true; first.resolve(value as Packet); }
	});
	child.once('error', error => { first.reject(error); });
	child.once('close', (code, signal) => { clearTimeout(deadline); if (!received) first.reject(new Error(`Native guard child closed before evidence: ${output}`)); closed.resolve({ code, signal }); });
	void first.promise.catch(() => undefined);
	return { child, first: first.promise, closed: closed.promise, release() { child.send('release'); } };
}
