/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { mkdir, rename, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { setImmediate as turn } from 'node:timers/promises';
import test from 'node:test';
import { captureLightscaperNativePhotoGrantedFilesystemCurrentV1 as capture } from '../desktop/lightscaper-native-photo-granted-filesystem-current-v1.ts';
import { nativeGrantedFilesystemFixtureCurrentV1 as fixture, grantedFsPathCurrentV1 as path,
	grantedFsHashCurrentV1 as sha, GRANTED_FS_OP as op } from './helpers/lightscaper-native-granted-filesystem-fixture-current.ts';
const deadline = { timeout: 15000 };

void test('actual SGR1 role publishes genuine retained root/file bytes and closes independently', deadline, async context => fixture(context, async f => {
	const root = await f.root(), file = await root.openFile([path('photo.bin')]);
	assert.equal(file.byteLength, f.bytes.length); assert.ok(file.identity.volume && file.identity.object);
	await root.close(); assert.equal(sha(await file.read(0, file.byteLength)), sha(f.bytes));
	await assert.rejects(root.openFile([path('photo.bin')]));
	await file.close(); await file.close(); await assert.rejects(file.read(0, 1));
	const closing = f.role.close(); assert.equal(f.role.close(), closing); await closing; await f.native.joined;
	assert.equal(f.count(op.init), 1);
}));

void test('same native namespace capture is genuine and uses hard-bound actual methods', deadline, async context => fixture(context, async f => {
	const bound = capture(f.role, f.mediaDatabasePath); bound.assertCurrent();
	const descriptor = Object.getOwnPropertyDescriptor(f.role, 'openRoot');
	if (Object.isExtensible(f.role)) Object.defineProperty(f.role, 'openRoot', { value: () => { throw new Error('shadow method must not become authority'); }, configurable: true });
	try { const root = await bound.openRoot(path(f.rootPath), null); await root.close(); }
	finally {
		if (Object.isExtensible(f.role)) { if (descriptor) Object.defineProperty(f.role, 'openRoot', descriptor); else Reflect.deleteProperty(f.role, 'openRoot'); }
	}
	let reflections = 0;
	const poison = new Proxy({}, { get() { reflections++; throw Symbol('get'); }, ownKeys() { reflections++; throw Symbol('keys'); }, getPrototypeOf() { reflections++; throw Symbol('prototype'); } });
	assert.throws(() => capture(poison, f.mediaDatabasePath)); assert.equal(reflections, 0);
	await fixture(context, async other => { assert.throws(() => capture(f.role, other.mediaDatabasePath)); });
	await f.role.close(); assert.throws(() => bound.assertCurrent()); assert.throws(() => capture(f.role, f.mediaDatabasePath));
}));

void test('expected actual root identity refuses copied/substituted directories before file open', deadline, async context => fixture(context, async f => {
	const root = await f.root(), expected = root.identity; await root.close();
	const substitute = join(f.directory, 'substitute'); await mkdir(substitute);
	await assert.rejects(f.role.openRoot(path(substitute), expected)); assert.equal(f.count(op.fileOpen), 0);
	const reopened = await f.role.openRoot(path(f.rootPath), expected); await reopened.close();
}));

void test('native role refuses directory links and keeps retained root immune to path replacement', deadline, async context => fixture(context, async f => {
	const root = await f.root(), retained = join(f.directory, 'retained-root'); await rename(f.rootPath, retained);
	await symlink(f.outside, f.rootPath, process.platform === 'win32' ? 'junction' : 'dir');
	const file = await root.openFile([path('photo.bin')]); assert.equal(sha(await file.read(0, file.byteLength)), sha(f.bytes)); await file.close();
	await assert.rejects(f.role.openRoot(path(f.rootPath), null));
	await symlink(f.outside, join(retained, 'escape'), process.platform === 'win32' ? 'junction' : 'dir');
	await assert.rejects(root.openFile([path('escape'), path('photo.bin')])); await root.close();
}));

void test('managed and linked physical IO share the same four real namespace bookings', deadline, async context => fixture(context, async f => {
	const held = Array.from({ length: 4 }, () => f.bookIo()); let captures = 0;
	const poison = new Proxy({}, { get() { captures++; throw Symbol('no capture at capacity'); }, ownKeys() { captures++; throw Symbol('no keys'); } });
	await assert.rejects(f.role.openRoot(poison as ReturnType<typeof path>, null));
	assert.equal(captures, 0); assert.equal(f.count(op.rootOpen), 0);
	for (const hold of held) hold.release(); const root = await f.root(); await root.close();
}));

void test('one pending real file receipt refuses another pull before native work', deadline, async context => fixture(context, async f => {
	const root = await f.root(), file = await root.openFile([path('photo.bin')]), gate = f.hold();
	const read = f.track(file.read(0, file.byteLength)); await gate.entered;
	await assert.rejects(file.read(0, 1)); assert.equal(f.count(op.read), 1);
	gate.release(); assert.equal(sha(await read), sha(f.bytes)); await file.close(); await root.close();
}));

void test('four accepted native receipts retain all shared IO slots until actual join', deadline, async context => fixture(context, async f => {
	const root = await f.root(), files = [];
	for (let index = 0; index < 5; index++) files.push(await root.openFile([path('photo.bin')]));
	const gate = f.hold(), pending = files.slice(0, 4).map(file => f.track(file.read(0, file.byteLength))); await gate.entered;
	await assert.rejects(files[4]!.read(0, 1)); assert.equal(f.count(op.read), 4);
	assert.throws(() => f.bookIo()); gate.release();
	for (const bytes of await Promise.all(pending)) assert.equal(sha(bytes), sha(f.bytes));
	const hold = f.bookIo(); hold.release(); for (const file of files) await file.close(); await root.close();
}));

void test('source-owned native file ranges reject before sending or allocating oversized payload', deadline, async context => fixture(context, async f => {
	const root = await f.root(), file = await root.openFile([path('photo.bin')]);
	for (const [offset, length] of [[0, 0], [0, 1048577], [file.byteLength, 1], [Number.MAX_SAFE_INTEGER, 2]]) {
		await assert.rejects(file.read(offset, length));
	}
	assert.equal(f.count(op.read), 0); await file.close(); await root.close();
}));

void test('late native FILE_OPEN after opaque cancellation cannot escape a public file owner', deadline, async context => fixture(context, async f => {
	const root = await f.root(), gate = f.hold(), controller = new AbortController(), reason = Symbol('opaque-cancel');
	const pending = f.track(root.openFile([path('photo.bin')], { signal: controller.signal }));
	const outcome = pending.then(value => ({ value }), (error: unknown) => ({ error })); await gate.entered;
	controller.abort(reason); gate.release(); const result = await outcome;
	assert.ok('error' in result); assert.equal(result.error, reason);
	await f.role.close(); await f.native.joined;
}));

void test('whole-role close fences input immediately and joins genuine held native receipts/process', deadline, async context => fixture(context, async f => {
	const root = await f.root(), file = await root.openFile([path('photo.bin')]), gate = f.hold();
	const read = f.track(file.read(0, file.byteLength)), result = read.then(value => ({ value }), (error: unknown) => ({ error })); await gate.entered;
	const closing = f.role.close(); let reflected = 0;
	const poison = new Proxy({}, { get() { reflected++; throw Symbol('closed input'); }, ownKeys() { reflected++; throw Symbol('closed keys'); } });
	await assert.rejects(f.role.openRoot(poison as ReturnType<typeof path>, null)); assert.equal(reflected, 0);
	gate.release(); await closing; await result; await f.native.joined;
	await assert.rejects(file.read(0, 1));
}));

void test('real native crash settles accepted/future reads and actual child stdio retirement', deadline, async context => fixture(context, async f => {
	const root = await f.root(), file = await root.openFile([path('photo.bin')]), gate = f.hold();
	const pending = f.track(file.read(0, file.byteLength)); const outcome = pending.then(() => ({ resolved: true }), (error: unknown) => ({ error }));
	await gate.entered; f.native.child.kill('SIGKILL'); await f.native.joined; gate.release();
	assert.ok('error' in await outcome); await assert.rejects(file.read(0, 1));
	try { await f.role.close(); } catch (error) { f.expectCleanup(error); }
}));

void test('root/scanner native handle capacities refuse before opening a partial extra owner', deadline, async context => fixture(context, async f => {
	const roots = [];
	for (let index = 0; index < 64; index++) roots.push(await f.root());
	await assert.rejects(f.root()); assert.equal(f.count(op.rootOpen), 64);
	await roots.pop()!.close(); roots.push(await f.root());
	const scans = [];
	for (let index = 0; index < 4; index++) scans.push(await roots[0]!.openScan([]));
	await assert.rejects(roots[0]!.openScan([])); assert.equal(f.count(op.scanOpen), 4);
	for (const scan of scans) await scan.close(); for (const root of roots) await root.close();
}));

void test('explicit close waits for its actual accepted scan receipt without stealing an IO slot', deadline, async context => fixture(context, async f => {
	const root = await f.root(), scan = await root.openScan([]), gate = f.hold();
	const pending = f.track(scan.next()); const result = pending.then(value => ({ value }), (error: unknown) => ({ error })); await gate.entered;
	let settled = false; const closing = scan.close(); void closing.then(() => { settled = true; }, () => { settled = true; });
	await turn(); assert.equal(settled, false); gate.release(); await closing; await result;
	await assert.rejects(scan.next()); await root.close();
}));

void test('actual native close EINTR never retries reused descriptor and source-quarantines role', {
	...deadline, skip: process.platform !== 'linux',
}, async context => fixture(context, async f => {
	const root = await f.root(), file = await root.openFile([path('photo.bin')]);
	assert.equal(sha(await file.read(0, file.byteLength)), sha(f.bytes));
	await assert.rejects(file.close()); await assert.rejects(file.read(0, 1)); assert.throws(() => capture(f.role, f.mediaDatabasePath));
	const outcome = await f.role.close().then(() => ({ resolved: true }), (error: unknown) => ({ error }));
	assert.ok('error' in outcome); f.expectCleanup(outcome.error);
	await f.native.joined; assert.match(f.native.stderr(), /SCAPE_CLOSE_FAULT actual=1 replacement=1 retries=0/u);
	assert.throws(() => f.bookIo());
}, true));
