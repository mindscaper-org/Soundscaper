/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstat, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { TestContext } from 'node:test';
import { copyNativeTestFixture } from '../../scripts/lib/node-native-test-fixtures.ts';
import { LightscaperNativePhotoGrantedFilesystemCurrentV1 as Role } from '../../desktop/lightscaper-native-photo-granted-filesystem-current-v1.ts';
import { LightscaperNativeOriginalStoreCurrentV1 as Originals } from '../../desktop/lightscaper-native-original-store-current-v1.ts';
import { registerLightscaperNativeOriginalPhysicalNamespaceCurrentV1 as register } from '../../desktop/lightscaper-native-original-physical-namespace-current-v1.ts';

export const GRANTED_FS_OP = Object.freeze({ init: 1, rootOpen: 2, rootClose: 3, fileOpen: 4, read: 5, fileClose: 6,
	scanOpen: 7, next: 8, scanClose: 9, shutdown: 10 });
export function grantedFsPathCurrentV1(value: string | Buffer) {
	return Object.freeze({ encoding: process.platform === 'win32' ? 'windows-utf16le' as const : 'posix-bytes' as const,
		bytes: new Uint8Array(typeof value === 'string' ? Buffer.from(value, process.platform === 'win32' ? 'utf16le' : 'utf8') : value) });
}
export function grantedFsHashCurrentV1(value: Uint8Array): string { return createHash('sha256').update(value).digest('hex'); }
export function grantedFsComponentKeyCurrentV1(value: Readonly<{ encoding: string; bytes: Uint8Array }>): string {
	return `${value.encoding}:${Buffer.from(value.bytes).toString('hex')}`;
}

type ActualRole = Awaited<ReturnType<typeof Role.open>>;
type Root = Awaited<ReturnType<ActualRole['openRoot']>>;
interface Native {
	readonly child: ChildProcessWithoutNullStreams;
	readonly joined: Promise<void>;
	readonly counts: Map<number, number>;
	readonly stderr: () => string;
	maximumResponse(opcode: number): number;
	hold(opcode?: number): Readonly<{ entered: Promise<void>; release(): void }>;
}
function actualNative(binary: string): Native {
	const child = spawn(binary, [], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
	const joined = new Promise<void>(resolve => { child.once('close', () => { resolve(); }); });
	let stderr = '', input = Buffer.alloc(0), output = Buffer.alloc(0), held: Buffer[] | undefined, heldBytes = 0, signalEntered: (() => void) | undefined;
	let holdOpcode: number | undefined;
	const counts = new Map<number, number>(), maxima = new Map<number, number>(), write = child.stdin.write, emit = child.stdout.emit;
	Object.defineProperty(child.stdin, 'write', { configurable: true, value: function(this: typeof child.stdin, ...args: unknown[]) {
		if (args[0] instanceof Uint8Array) {
			input = Buffer.concat([input, args[0]]);
			while (input.length >= 16) {
				assert.equal(input.subarray(0, 4).toString(), 'SGR1'); const length = input.readUInt32BE(12);
				assert.ok(length <= 262144); if (input.length < 16 + length) break;
				const op = input[5]!; if (holdOpcode === op) { held = []; holdOpcode = undefined; } counts.set(op, (counts.get(op) ?? 0) + 1); input = input.subarray(16 + length);
			}
		}
		return Reflect.apply(write, this, args) as boolean;
	} });
	Object.defineProperty(child.stdout, 'emit', { configurable: true, value: function(this: typeof child.stdout, event: unknown, ...args: unknown[]) {
		if (event === 'data' && Buffer.isBuffer(args[0])) {
			output = Buffer.concat([output, args[0]]); assert.ok(output.byteLength <= 2 * 1048576);
			while (output.length >= 16) {
				assert.equal(output.subarray(0, 4).toString(), 'SGR1'); const length = output.readUInt32BE(12); assert.ok(length <= 1048576);
				if (output.length < 16 + length) break; const opcode = output[5]!;
				maxima.set(opcode, Math.max(maxima.get(opcode) ?? 0, length)); output = output.subarray(16 + length);
			}
		}
		if (event === 'data' && held && Buffer.isBuffer(args[0])) {
			heldBytes += args[0].byteLength; assert.ok(heldBytes <= 4 * 1048576 + 262144);
			held.push(Buffer.from(args[0])); signalEntered?.(); signalEntered = undefined; return true;
		}
		return Reflect.apply(emit, this, [event, ...args]) as boolean;
	} });
	child.stderr.on('data', (value: Buffer) => { if (stderr.length < 8192) stderr += value.toString().slice(0, 8192 - stderr.length); });
	return Object.freeze({ child, joined, counts, stderr: () => stderr, maximumResponse: (opcode: number): number => maxima.get(opcode | 128) ?? 0, hold(opcode?: number) {
		assert.equal(held, undefined); assert.equal(holdOpcode, undefined);
		if (opcode === undefined) held = []; else holdOpcode = opcode; heldBytes = 0;
		const entered = new Promise<void>(resolve => { signalEntered = resolve; }); let released = false;
		return Object.freeze({ entered, release(): void {
			if (released) return; released = true; const chunks = held ?? []; held = undefined; holdOpcode = undefined; heldBytes = 0; signalEntered = undefined;
			for (const bytes of chunks) Reflect.apply(emit, child.stdout, ['data', bytes]);
		} });
	} });
}

export async function nativeGrantedFilesystemFixtureCurrentV1(context: TestContext,
	run: (fixture: ReturnType<typeof fixtureFor>) => Promise<void>, fault = false): Promise<void> {
	const directory = await mkdtemp(join(tmpdir(), 'lightscaper-granted-fs-'));
	const appData = join(directory, 'app-data'), rootPath = join(directory, 'root'), outside = join(directory, 'outside');
	let originals: Originals | undefined, namespace: ReturnType<typeof register> | undefined, role: ActualRole | undefined, native: Native | undefined;
	let fixture: ReturnType<typeof fixtureFor> | undefined;
	const gates: Array<Readonly<{ release(): void }>> = [], holds: Array<Readonly<{ release(): void }>> = [];
	let timer: ReturnType<typeof setTimeout> | undefined, expectedCleanup: unknown, hasExpectedCleanup = false;
	const abortFailures: unknown[] = [], failures: unknown[] = []; let failed = false, primary: unknown;
	const stop = (): void => {
		for (const action of [...gates.map(gate => () => { gate.release(); }), () => { role?.stop(); }, () => { native?.child.kill('SIGKILL'); }]) {
			try { action(); } catch (error) { abortFailures.push(error); }
		}
	};
	context.signal.addEventListener('abort', stop, { once: true });
	try {
		const explicit = fault ? process.env.SCAPE_GRANTED_FILESYSTEM_CLOSE_FAULT_TEST_BINARY : process.env.SCAPE_GRANTED_FILESYSTEM_TEST_BINARY;
		const binary = explicit ?? join(directory, process.platform === 'win32' ? 'fixture.exe' : 'fixture');
		if (!explicit) assert.ok(copyNativeTestFixture({ repositoryRoot: fileURLToPath(new URL('../../', import.meta.url)),
			kind: fault ? 'lightscaper-granted-filesystem-close-fault' : 'lightscaper-granted-filesystem', outputPath: binary }), 'Prepare the actual shared filesystem role artifact.');
		assert.ok(isAbsolute(binary)); assert.equal((await lstat(binary)).isFile(), true);
		await mkdir(appData); await mkdir(rootPath); await mkdir(outside); await mkdir(join(rootPath, 'nested'));
		const bytes = Buffer.from('real native granted source\n'), foreign = Buffer.from('outside native sentinel\n');
		await writeFile(join(rootPath, 'photo.bin'), bytes); await writeFile(join(rootPath, 'nested', 'photo.bin'), bytes);
		await writeFile(join(outside, 'photo.bin'), foreign);
		originals = await Originals.open({ appDataPath: appData });
		const databasePath = join(appData, 'Lightscaper', 'project-library', 'v1', 'native-photo-originals.sqlite3'); namespace = register(databasePath);
		timer = setTimeout(stop, 14000);
		role = await Role.open({ start: () => { native = actualNative(binary); return native.child; }, mediaDatabasePath: databasePath });
		assert.ok(native); if (context.signal.aborted) stop();
		fixture = fixtureFor(role, native, namespace, gates, holds, directory, rootPath, outside, bytes, foreign,
			(error: unknown) => { expectedCleanup = error; hasExpectedCleanup = true; });
		await run(fixture);
	} catch (error) { failed = true; primary = error; } finally {
		for (const gate of gates) { try { gate.release(); } catch (error) { failures.push(error); } }
		try { await role?.close(); } catch (error) { if (!hasExpectedCleanup || !Object.is(error, expectedCleanup)) failures.push(error); }
		if (native) { if (native.child.exitCode === null && native.child.signalCode === null) native.child.kill('SIGKILL'); await native.joined; }
		await fixture?.join();
		for (const hold of holds) { try { hold.release(); } catch (error) { failures.push(error); } }
		try { await originals?.close(); } catch (error) { failures.push(error); }
		try { namespace?.retire(); } catch (error) { failures.push(error); }
		if (timer) clearTimeout(timer); context.signal.removeEventListener('abort', stop); failures.push(...abortFailures);
		try { await rm(directory, { recursive: true, force: true }); } catch (error) { failures.push(error); }
	}
	if (failures.length) throw new AggregateError(failed ? [primary, ...failures] : failures, 'Actual native FS test retirement failed.');
	if (failed) throw primary;
}
function fixtureFor(role: ActualRole, native: Native, namespace: ReturnType<typeof register>, gates: Array<Readonly<{ release(): void }>>,
	holds: Array<Readonly<{ release(): void }>>, directory: string, rootPath: string, outside: string, bytes: Buffer, foreign: Buffer,
	expectCleanup: (error: unknown) => void) {
	const owned = new Set<Promise<unknown>>();
	return Object.freeze({ role, native, directory, rootPath, outside, bytes, foreign,
		root: (): Promise<Root> => role.openRoot(grantedFsPathCurrentV1(rootPath), null),
		count: (opcode: number): number => native.counts.get(opcode) ?? 0,
		hold: (opcode?: number) => { const gate = native.hold(opcode); gates.push(gate); return gate; },
		bookIo: () => { const hold = namespace.read(); holds.push(hold); return hold; },
		track: <Value>(work: Promise<Value>): Promise<Value> => { owned.add(work); void work.then(() => { owned.delete(work); }, () => { owned.delete(work); }); return work; },
		join: async (): Promise<void> => { await Promise.allSettled([...owned]); },
		expectCleanup, mediaDatabasePath: join(directory, 'app-data', 'Lightscaper', 'project-library', 'v1', 'native-photo-originals.sqlite3'),
	});
}
