/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { photoNativeTestFixtureResultCurrentV1 } from '../../scripts/lib/node-native-test-fixtures.ts';
import { ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cp, lstat, mkdir, mkdtemp, open, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { TestContext } from 'node:test';
import { LightscaperNativePhotoPayloadsCurrentV1 as Payloads } from '../../desktop/lightscaper-native-photo-payload-current-v1.ts';
import { LightscaperNativePhotoGrantedFilesystemCurrentV1 as Filesystem } from '../../desktop/lightscaper-native-photo-granted-filesystem-current-v1.ts';
import { LightscaperNativePhotoRawCurrentV1 as Raw } from '../../desktop/lightscaper-native-photo-raw-current-v1.ts';
import { LightscaperNativeOriginalStoreCurrentV1 as Originals } from '../../desktop/lightscaper-native-original-store-current-v1.ts';
import { verifyLightscaperPhotoNativeBuildResultCurrentV1 as verify } from '../../scripts/lib/lightscaper-photo-native-build-current-v1.ts';
import { stageLightscaperPhotoNativeCurrentV1 as stage, verifyLightscaperPhotoNativeStageCurrentV1 as verifyStage } from '../../scripts/lib/lightscaper-photo-native-stage-current-v1.ts';
import { stageDesktopLightscaperRawRuntimeCurrentV1 as stageWasm } from '../../scripts/lib/desktop-lightscaper-raw-runtime-current-v1.ts';
export { Payloads, Filesystem, Raw, verify, verifyStage };
export const PHOTO_NATIVE_TEST_CURRENT_V1 = Object.freeze({ concurrency: false, timeout: 15000 });
export const PHOTO_NATIVE_MANIFEST_CURRENT_V1 = 'config/lightscaper-native-photo-payload-current-v1.json';
export const PHOTO_NATIVE_BUILD_RESULT_CURRENT_V1 = 'build-result.json';
export const photoNativeHashCurrentV1 = (value: Uint8Array): string => createHash('sha256').update(value).digest('hex');
export function photoNativeTargetCurrentV1(): 'linux-x64' | 'linux-arm64' | 'mac-arm64' | 'win-x64' | 'win-arm64' {
	if (process.platform === 'linux' && process.arch === 'x64') return 'linux-x64';
	if (process.platform === 'linux' && process.arch === 'arm64') return 'linux-arm64';
	if (process.platform === 'darwin' && process.arch === 'arm64') return 'mac-arm64';
	if (process.platform === 'win32' && process.arch === 'x64') return 'win-x64';
	if (process.platform === 'win32' && process.arch === 'arm64') return 'win-arm64';
	throw new Error('Photo native deployment requires a maintained actual target.');
}
type Owner = Awaited<ReturnType<typeof Payloads.open>>;
type Closeable = Readonly<{ close(): Promise<void> }>;
type Child = { actual: ChildProcess; closed: boolean; joined: Promise<void> };
type Gate = Readonly<{ promise: Promise<void>; release(): void }>;
export async function photoNativeDeploymentFixtureCurrentV1(context: TestContext,
	run: (fixture: ReturnType<typeof fixtureFor>) => Promise<void>): Promise<void> {
	const repositoryRoot = fileURLToPath(new URL('../../', import.meta.url));
	const prepared = process.env.SCAPE_PHOTO_NATIVE_TEST_BUILD_RESULT ?? photoNativeTestFixtureResultCurrentV1({ repositoryRoot });
	assert.ok(prepared && isAbsolute(prepared), 'Root must prepare the real complete producer result once; no per-case compiler or skipped/fake payload.');
	assert.ok((await lstat(prepared)).isDirectory());
	const directory = await mkdtemp(join(tmpdir(), 'lightscaper-photo-deployment-'));
	const buildResultRoot = join(directory, 'result');
	const runtimeRoot = join(directory, 'resources/runtime'), applicationRoot = join(directory, 'app');
	const scope = new AbortController(), gates = new Set<() => void>(), owners = new Set<Closeable>(), payloads = new Set<Owner>(), children: Child[] = [], tasks = new Set<Promise<unknown>>();
	const descriptor = Object.getOwnPropertyDescriptor(ChildProcess.prototype, 'emit'), actualEmit = ChildProcess.prototype.emit;
	let originals: Originals | undefined, expired = false, failed = false, primary: unknown;
	const cleanup: unknown[] = [];
	const stop = (): void => {
		for (const release of gates) release(); if (!scope.signal.aborted) scope.abort(context.signal.aborted ? context.signal.reason : new DOMException('Native deployment test retired.', 'AbortError'));
		for (const owner of payloads) { try { owner.stop(); } catch (error) { cleanup.push(error); } }
		for (const child of children) if (!child.closed) child.actual.kill('SIGKILL');
	};
	Object.defineProperty(ChildProcess.prototype, 'emit', { configurable: true, writable: true, value: function(this: ChildProcess, event: unknown, ...args: unknown[]) {
		if (event === 'spawn' && !children.some(value => value.actual === this)) {
			const record: Child = { actual: this, closed: false, joined: Promise.resolve() };
			record.joined = new Promise<void>(resolve => { this.once('close', () => { record.closed = true; resolve(); }); }); children.push(record);
			if (children.length > 128) { cleanup.push(new Error('Native deployment exceeded its bounded actual test-process inventory.')); stop(); }
		}
		return Reflect.apply(actualEmit, this, [event, ...args]) as boolean;
	} });
	context.signal.addEventListener('abort', stop, { once: true }); const timer = setTimeout(() => { expired = true; stop(); }, 14000);
	try {
		await cp(prepared, buildResultRoot, { recursive: true, errorOnExist: true, force: false });
		await mkdir(join(applicationRoot, 'config'), { recursive: true }); await mkdir(runtimeRoot, { recursive: true });
		const wasm = await stageWasm({ repositoryRoot, runtimeRoot });
		await mkdir(join(directory, 'app-data'));
		originals = await Originals.open({ appDataPath: join(directory, 'app-data') });
		const result = await verify({ repositoryRoot, buildResultRoot, target: photoNativeTargetCurrentV1() });
		const f = fixtureFor({ context, directory, repositoryRoot, buildResultRoot, runtimeRoot, applicationRoot, scope, result, wasm, gates, owners, payloads, children, tasks });
		context.signal.throwIfAborted(); await run(f);
	} catch (error) { failed = true; primary = error; }
	finally {
		for (const release of gates) release();
		for (const owner of [...owners].reverse()) { try { await owner.close(); } catch (error) { cleanup.push(error); } }
		for (const owner of payloads) { try { await owner.close(); } catch (error) { cleanup.push(error); } }
		for (const child of children) { if (!child.closed) child.actual.kill('SIGKILL'); await child.joined; }
		await Promise.allSettled([...tasks]); try { await originals?.close(); } catch (error) { cleanup.push(error); }
		if (timer) clearTimeout(timer); context.signal.removeEventListener('abort', stop);
		if (descriptor) Object.defineProperty(ChildProcess.prototype, 'emit', descriptor); else Reflect.deleteProperty(ChildProcess.prototype, 'emit');
		try { await rm(directory, { recursive: true, force: true }); } catch (error) { cleanup.push(error); }
	}
	if (expired) cleanup.push(new Error('Native deployment active deadline expired after actual joins.'));
	if (cleanup.length) throw new AggregateError([...(failed ? [primary] : []), ...cleanup], 'Native deployment test and retirement failed.');
	if (failed) throw primary;
}
function fixtureFor(input: Readonly<{ context: TestContext; directory: string; repositoryRoot: string; buildResultRoot: string; runtimeRoot: string; applicationRoot: string;
	scope: AbortController; result: Awaited<ReturnType<typeof verify>>; wasm: Awaited<ReturnType<typeof stageWasm>>; gates: Set<() => void>;
	owners: Set<Closeable>; payloads: Set<Owner>; children: Child[]; tasks: Set<Promise<unknown>> }>) {
	const options = { repositoryRoot: input.repositoryRoot, buildResultRoot: input.buildResultRoot, runtimeRoot: input.runtimeRoot,
		applicationRoot: input.applicationRoot, target: photoNativeTargetCurrentV1(), allowWorkingTree: true as const, signal: input.scope.signal };
	return Object.freeze({ ...input, options, mediaDatabasePath: join(input.directory, 'app-data/Lightscaper/project-library/v1/native-photo-originals.sqlite3'),
		stage: () => stage(options), verify: () => verifyStage(options),
		own<Value extends Closeable>(value: Value): Value { input.owners.add(value); return value; },
		track<Value>(work: Promise<Value>): Promise<Value> { input.tasks.add(work); void work.then(() => { input.tasks.delete(work); }, () => { input.tasks.delete(work); }); return work; },
		gate(): Gate { let release!: () => void; const promise = new Promise<void>(resolve => { release = resolve; }); input.gates.add(release); return Object.freeze({ promise, release }); },
		async openPayload() { const value = await Payloads.open({ applicationRoot: input.applicationRoot, resourcesPath: join(input.directory, 'resources'), packaged: false, signal: input.scope.signal }); input.payloads.add(value); return value; },
		async reached(barrier: Promise<void>, accepted: Promise<unknown>): Promise<void> {
			await Promise.race([barrier, accepted.then(() => { throw new Error('Real operation ended before its owned barrier.'); }, error => { throw error; })]); input.context.signal.throwIfAborted();
		},
		async inputFile(bytes: Uint8Array<ArrayBuffer>) {
			const path = join(input.directory, 'input.dng'), file = await open(path, 'wx+'); input.owners.add(file); await file.writeFile(bytes); const read = file.read;
			return Object.freeze({ byteLength: bytes.byteLength, contentSha256: photoNativeHashCurrentV1(bytes), async read(offset: number, length: number, options: Readonly<{ signal: AbortSignal }>) {
				options.signal.throwIfAborted(); const body = new Uint8Array(length); const result = await Reflect.apply(read, file, [body, 0, length, offset]) as { bytesRead: number };
				assert.equal(result.bytesRead, length); options.signal.throwIfAborted(); return body;
			} });
		},
		activeChildren: (): number => input.children.filter(value => !value.closed).length,
	});
}
/** A pass-through observer of actual FileHandle.sync. It never supplies a fake
 * success/result; the foreign actor runs only after genuine file sync joined. */
export async function withPhotoNativeFileSyncCurrentV1(directory: string, observe: () => Promise<void>, work: () => Promise<void>): Promise<void> {
	const probe = await open(join(directory, 'sync-probe'), 'wx'); const prototype: object = Object.getPrototypeOf(probe) as object; await probe.close();
	const descriptor = Object.getOwnPropertyDescriptor(prototype, 'sync'); assert.ok(descriptor && typeof descriptor.value === 'function');
	const sync = descriptor.value as (...args: unknown[]) => Promise<void>; let entered = false;
	Object.defineProperty(prototype, 'sync', { ...descriptor, value: async function(this: Awaited<ReturnType<typeof open>>, ...args: unknown[]) {
		await Reflect.apply(sync, this, args); const details = await this.stat(); if (!entered && details.isFile() && details.size > 0) { entered = true; await observe(); }
	} });
	try { await work(); assert.equal(entered, true, 'The real staging artifact must reach its native file-sync boundary.'); }
	finally { Object.defineProperty(prototype, 'sync', descriptor); }
}
export async function readPhotoNativeBuildJsonCurrentV1(root: string): Promise<unknown> { return JSON.parse((await readFile(join(root, PHOTO_NATIVE_BUILD_RESULT_CURRENT_V1))).toString('utf8')) as unknown; }
