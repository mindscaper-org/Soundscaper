/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, open, readFile, readdir, rm, type FileHandle } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { LightscaperNativeOriginalFilesCurrentV1, prepareLightscaperNativeOriginalStorageCurrentV1 } from '../desktop/lightscaper-native-original-files-current-v1.ts';
import { lightscaperNativePhotoOriginalBodyPathCurrentV1 } from '../desktop/lightscaper-native-original-index-current-v1.ts';
import type { LightscaperNativeOriginalBindingCurrentV1 } from '../desktop/lightscaper-native-original-index-current-v1.ts';
import { deferred, remainsPending } from './helpers/async-test-control.ts';

type Paths = Awaited<ReturnType<typeof prepareLightscaperNativeOriginalStorageCurrentV1>>;
type Patch = (handle: FileHandle, path: string) => void;
type Fixture = Readonly<{ paths: Paths; instrument: (patch: Patch) => typeof open }>;
const PAYLOAD = Buffer.from('Native Original partial IO and opaque cleanup failures Ω.');
const BINDING: LightscaperNativeOriginalBindingCurrentV1 = Object.freeze({ storageKey: 'native-fault-original',
	contentSha256: createHash('sha256').update(PAYLOAD).digest('hex'), byteLength: PAYLOAD.length });

async function* chunks(): AsyncGenerator<Uint8Array> { yield new Uint8Array(PAYLOAD); }
function contains(error: unknown, expected: unknown): boolean {
	return error === expected || error instanceof AggregateError && error.errors.some((entry: unknown) => contains(entry, expected));
}
function carries(...expected: unknown[]): (error: unknown) => boolean {
	return error => { for (const value of expected) assert.equal(contains(error, value), true, 'The exact opaque failure must survive.'); return true; };
}
async function fixture(run: (value: Fixture) => Promise<void>): Promise<void> {
	const root = await mkdtemp(join(tmpdir(), 'lightscaper native file faults ü '));
	const closes: (() => Promise<void>)[] = [];
	let primary: unknown, failed = false;
	try {
		const paths = await prepareLightscaperNativeOriginalStorageCurrentV1(root);
		const instrument = (patch: Patch): typeof open => async (...args: Parameters<typeof open>) => {
			const handle = await open(...args);
			// Keep the actual native close before a test replaces the instance method.
			// Even an intentionally refused application close cannot leak this fixture.
			closes.push(handle.close.bind(handle)); patch(handle, String(args[0])); return handle;
		};
		await run({ paths, instrument });
	} catch (error) { failed = true; primary = error; }
	const cleanup = (await Promise.allSettled(closes.map(close => close()))).flatMap(result => result.status === 'rejected' ? [result.reason as unknown] : []);
	if (cleanup.length) throw new AggregateError([...(failed ? [primary] : []), ...cleanup], 'Real fixture handles did not retire; directory retained.');
	await rm(root, { recursive: true, force: true });
	if (failed) throw primary;
}
async function seed(paths: Paths): Promise<void> {
	const owner = new LightscaperNativeOriginalFilesCurrentV1(paths); await owner.put(BINDING, chunks()); await owner.retire();
}

test('Lightscaper native Original files join genuine partial writes and reads without losing bytes', async () => {
	await fixture(async ({ paths, instrument }) => {
		let writes = 0, reads = 0;
		const owner = new LightscaperNativeOriginalFilesCurrentV1(paths, instrument((handle, path) => {
			if (path.endsWith('.part')) {
				const write = handle.write.bind(handle);
				Object.defineProperty(handle, 'write', { value: async (bytes: Uint8Array, offset: number, length: number, position: number) => {
					writes += 1; return write(bytes, offset, Math.min(length, 3), position);
				} });
			}
			if (path.endsWith('.body')) {
				const read = handle.read.bind(handle);
				Object.defineProperty(handle, 'read', { value: async (bytes: Uint8Array, offset: number, length: number, position: number) => {
					reads += 1; return read(bytes, offset, Math.min(length, 2), position);
				} });
			}
		}));
		await owner.put(BINDING, chunks());
		assert.deepEqual(await owner.read(BINDING, 3, 17), new Uint8Array(PAYLOAD.subarray(3, 20)));
		assert.deepEqual(await readFile(lightscaperNativePhotoOriginalBodyPathCurrentV1(paths, BINDING.contentSha256)), PAYLOAD);
		assert.ok(writes > 1); assert.ok(reads > 1); assert.deepEqual(await readdir(paths.stagingRoot), []); await owner.retire();
	});
});

test('Lightscaper native Original zero-progress write refuses publication and retires its stage', async () => {
	await fixture(async ({ paths, instrument }) => {
		const owner = new LightscaperNativeOriginalFilesCurrentV1(paths, instrument((handle, path) => {
			if (path.endsWith('.part')) Object.defineProperty(handle, 'write', { value: async (buffer: Uint8Array) => ({ bytesWritten: 0, buffer }) });
		}));
		await assert.rejects(owner.put(BINDING, chunks()), /stopped accepting bytes/);
		assert.deepEqual(await readdir(paths.stagingRoot), []);
		await assert.rejects(readFile(lightscaperNativePhotoOriginalBodyPathCurrentV1(paths, BINDING.contentSha256)), { code: 'ENOENT' });
		await owner.retire();
	});
});

test('Lightscaper native Original zero-progress authentication closes its reader and refuses synthetic data', async () => {
	await fixture(async ({ paths, instrument }) => {
		await seed(paths); let closed = 0;
		const owner = new LightscaperNativeOriginalFilesCurrentV1(paths, instrument((handle, path) => {
			if (!path.endsWith('.body')) return;
			const close = handle.close.bind(handle);
			Object.defineProperty(handle, 'read', { value: async (buffer: Uint8Array) => ({ bytesRead: 0, buffer }) });
			Object.defineProperty(handle, 'close', { value: async () => { closed += 1; await close(); } });
		}));
		await assert.rejects(owner.verify(BINDING), /ended while authenticating/); assert.equal(closed, 1); await owner.retire();
	});
});

test('Lightscaper native Original refuses unlink and clean retirement after its stage close cannot be proved', async () => {
	await fixture(async ({ paths, instrument }) => {
		const closeFailure = Object.freeze({ source: 'stage-native-close-refused' }); let attempts = 0, opens = 0;
		const owner = new LightscaperNativeOriginalFilesCurrentV1(paths, instrument((handle, path) => {
			opens += 1;
			if (path.endsWith('.part')) Object.defineProperty(handle, 'close', { value: async () => { attempts += 1; throw closeFailure; } });
		}));
		await assert.rejects(owner.put(BINDING, chunks()), carries(closeFailure)); assert.ok(attempts >= 1);
		const stages = await readdir(paths.stagingRoot); assert.equal(stages.length, 1);
		assert.deepEqual(await readFile(join(paths.stagingRoot, stages[0]!)), PAYLOAD);
		await assert.rejects(readFile(lightscaperNativePhotoOriginalBodyPathCurrentV1(paths, BINDING.contentSha256)), { code: 'ENOENT' });
		await assert.rejects(owner.retire(), carries(closeFailure));
		const before = opens; await assert.rejects(owner.put(BINDING, chunks())); await assert.rejects(owner.verify(BINDING)); assert.equal(opens, before);
	});
});

for (const phase of ['authentication', 'bounded range'] as const) {
	test(`Lightscaper native Original ${phase} preserves its primary and refused close and fences retirement`, async () => {
		await fixture(async ({ paths, instrument }) => {
			await seed(paths);
			const primary = Object.freeze({ source: phase }), closeFailure = Object.freeze({ source: 'native-reader-close-refused' });
			let fail = phase === 'authentication';
			const owner = new LightscaperNativeOriginalFilesCurrentV1(paths, instrument((handle, path) => {
				if (!path.endsWith('.body')) return;
				const read = handle.read.bind(handle), close = handle.close.bind(handle);
				Object.defineProperty(handle, 'read', { value: async (bytes: Uint8Array, offset: number, length: number, position: number) => {
					if (fail) throw primary; return read(bytes, offset, length, position);
				} });
				Object.defineProperty(handle, 'close', { value: async () => { if (fail) throw closeFailure; await close(); } });
			}));
			if (phase === 'bounded range') { await owner.verify(BINDING); fail = true; }
			await assert.rejects(phase === 'authentication' ? owner.verify(BINDING) : owner.read(BINDING, 0, 4), carries(primary, closeFailure));
			await assert.rejects(owner.retire(), carries(closeFailure));
		});
	});
}

test('Lightscaper native Original verification joins a held native close before reporting failure', { timeout: 10_000 }, async () => {
	await fixture(async ({ paths, instrument }) => {
		await seed(paths); const entered = deferred<void>(), release = deferred<void>();
		void release.promise.catch(() => undefined);
		const closeFailure = Object.freeze({ source: 'held-native-close-refused' });
		const owner = new LightscaperNativeOriginalFilesCurrentV1(paths, instrument((handle, path) => {
			if (path.endsWith('.body')) Object.defineProperty(handle, 'close', { value: async () => { entered.resolve(); await release.promise; } });
		}));
		const work = owner.verify(BINDING), refused = assert.rejects(work, carries(closeFailure));
		try {
			await Promise.race([entered.promise, work.then(() => { throw new Error('Verification completed before close admission.'); }, (error: unknown) => { throw error; })]);
			assert.equal(await remainsPending(work), true);
			release.reject(closeFailure); await refused; await assert.rejects(owner.retire(), carries(closeFailure));
		} finally { release.reject(closeFailure); await refused; }
	});
});
