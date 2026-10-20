/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { ChildProcess, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { rawDngFixtureV1 } from './helpers/lightscaper-raw-dng-current-fixture.ts';
import { nativeRawNeutralOracleCurrentV1 as oracle } from './helpers/lightscaper-native-raw-engine-fixture-current.ts';
import { grantedFsPathCurrentV1 as path } from './helpers/lightscaper-native-granted-filesystem-fixture-current.ts';
import { photoNativeDeploymentFixtureCurrentV1 as fixture, PHOTO_NATIVE_TEST_CURRENT_V1 as options,
	PHOTO_NATIVE_MANIFEST_CURRENT_V1 as manifest, photoNativeHashCurrentV1 as hash, Payloads, Filesystem, Raw } from './helpers/lightscaper-photo-native-deployment-fixture-current.ts';

void test('genuine staged FS prepared start is one-use and feeds the actual retained handle reader', options, async context => fixture(context, async f => {
	await f.stage(); const owner = await f.openPayload(), prepared = f.own(await owner.prepare('granted-filesystem'));
	let actual: ChildProcessWithoutNullStreams | undefined;
	const fs = f.own(await Filesystem.open({ mediaDatabasePath: f.mediaDatabasePath, start: () => { actual = prepared.start(); return actual; } }));
	assert.ok(actual instanceof ChildProcess); assert.throws(() => prepared.start());
	const body = Buffer.from('actual deployed read-only broker body\n'); await writeFile(join(f.directory, 'photo.bin'), body);
	const root = f.own(await fs.openRoot(path(f.directory), null)), file = f.own(await root.openFile([path('photo.bin')]));
	await root.close(); assert.equal(hash(await file.read(0, file.byteLength)), hash(body)); await file.close(); await fs.close(); await prepared.close();
	assert.equal(f.activeChildren(), 0);
}));

void test('actual isolated staged RAW role produces real neutral pixels and exits before callback delivery', options, async context => fixture(context, async f => {
	await f.stage(); const owner = await f.openPayload(), prepared = f.own(await owner.prepare('raw-engine')), input = rawDngFixtureV1();
	const expected = await oracle(input.bytes), source = await f.inputFile(input.bytes);
	const raw = f.own(Raw.create({ start: prepared.start, retire: prepared.close, signal: f.scope.signal }));
	try {
		await raw.withDecoded({ mode: 'neutral', tier: null, source }, value => {
			assert.equal(f.activeChildren(), 0, 'Actual M5/native child and stdio must retire before pixels reach a consumer.');
			assert.equal(value.engine, 'lightscaper-libraw-native'); assert.equal(value.engineVersion, 1); assert.equal(value.format, 'rgba16le');
			assert.equal(value.width, expected.frame.descriptor.width); assert.equal(value.height, expected.frame.descriptor.height);
			const bytes = new Uint8Array(expected.frame.pixels.length * 2), view = new DataView(bytes.buffer);
			try { for (let index = 0; index < expected.frame.pixels.length; index++) view.setUint16(index * 2, expected.frame.pixels[index]!, true); assert.equal(hash(value.bytes), hash(bytes)); }
			finally { bytes.fill(0); }
		});
	} finally { input.bytes.fill(0); input.sensor.fill(0); expected.frame.pixels.fill(0); }
	await raw.close(); await prepared.close();
}));

void test('unclaimed RAW prepared children are bounded across owners and return capacity only after actual exit', options, async context => fixture(context, async f => {
	await f.stage(); const firstOwner = await f.openPayload(), secondOwner = await f.openPayload();
	const first = f.own(await firstOwner.prepare('raw-engine')); const before = f.children.length;
	await assert.rejects(secondOwner.prepare('raw-engine')); assert.equal(f.children.length, before);
	assert.equal(f.activeChildren(), 1); const closed = first.close(); assert.equal(first.close(), closed); await closed;
	assert.equal(f.activeChildren(), 0); assert.throws(() => first.start());
	const second = f.own(await secondOwner.prepare('raw-engine')); await second.close(); assert.equal(f.activeChildren(), 0);
}));

void test('payload stop refuses before borrowed preparation options and joined close retires unclaimed peers', options, async context => fixture(context, async f => {
	await f.stage(); const owner = await f.openPayload(); f.own(await owner.prepare('raw-engine'));
	owner.stop(); let captures = 0;
	const poison = new Proxy({}, { ownKeys() { captures++; throw Symbol('closed options'); }, get() { captures++; throw Symbol('closed get'); } });
	const method = owner.prepare, rejected: unknown = Reflect.apply(method, owner, ['granted-filesystem', poison]);
	assert.ok(rejected instanceof Promise); await assert.rejects(rejected); assert.equal(captures, 0);
	const closed = owner.close(); assert.equal(owner.close(), closed); await closed; assert.equal(f.activeChildren(), 0);
}));

void test('changed protected manifest refuses before any native spawn and does not substitute another role', options, async context => fixture(context, async f => {
	await f.stage(); const file = join(f.applicationRoot, manifest), original = await readFile(file);
	await writeFile(file, '{"schemaVersion":1,"roles":{}}\n');
	await assert.rejects(Payloads.open({ applicationRoot: f.applicationRoot, resourcesPath: join(f.directory, 'resources'), packaged: false }));
	assert.equal(f.children.length, 0); await writeFile(file, original); const owner = await f.openPayload();
	let reflected = 0; const poison = new Proxy({}, { get() { reflected++; throw Symbol('role'); }, ownKeys() { reflected++; throw Symbol('role keys'); } });
	const rejected: unknown = Reflect.apply(owner.prepare, owner, [poison]); assert.ok(rejected instanceof Promise); await assert.rejects(rejected); assert.equal(reflected, 0); assert.equal(f.children.length, 0);
}));

void test('actual held FS INIT receipt cannot leave opening self-wait during producer close', options, async context => fixture(context, async f => {
	await f.stage(); const owner = await f.openPayload(), prepared = f.own(await owner.prepare('granted-filesystem'));
	const release = f.gate(); let entered!: () => void; const ready = new Promise<void>(resolve => { entered = resolve; });
	let restore: (() => void) | undefined;
	const opening = f.track(Filesystem.open({ mediaDatabasePath: f.mediaDatabasePath, start: () => {
		const child = prepared.start(), actualEmit = child.stdout.emit; let held = true; const chunks: Buffer[] = []; let bytes = 0;
		Object.defineProperty(child.stdout, 'emit', { configurable: true, writable: true, value: function(this: typeof child.stdout, event: unknown, ...args: unknown[]) {
			if (event === 'data' && held && Buffer.isBuffer(args[0])) { bytes += args[0].byteLength; assert.ok(bytes <= 262144); chunks.push(Buffer.from(args[0])); entered(); return true; }
			return Reflect.apply(actualEmit, this, [event, ...args]) as boolean;
		} });
		restore = () => { if (!held) return; held = false; for (const bytes of chunks) Reflect.apply(actualEmit, child.stdout, ['data', bytes]); child.stdout.emit = actualEmit; };
		void release.promise.then(() => { restore?.(); }); return child;
	} }));
	const outcome = opening.then(value => ({ value }), (error: unknown) => ({ error }));
	try {
		await f.reached(ready, opening); const closing = owner.close(); await closing; assert.equal(f.activeChildren(), 0); release.release();
		assert.ok('error' in await outcome);
	} finally { release.release(); restore?.(); const settled = await outcome; if ('value' in settled) { f.own(settled.value); await settled.value.close(); } }
}));
