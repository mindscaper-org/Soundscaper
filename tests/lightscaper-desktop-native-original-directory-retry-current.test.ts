/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { lstat, mkdtemp, open, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { LightscaperNativeOriginalFilesCurrentV1, prepareLightscaperNativeOriginalStorageCurrentV1 } from '../desktop/lightscaper-native-original-files-current-v1.ts';
import { lightscaperNativePhotoOriginalBodyPathCurrentV1 } from '../desktop/lightscaper-native-original-index-current-v1.ts';
import type { LightscaperNativeOriginalBindingCurrentV1 } from '../desktop/lightscaper-native-original-index-current-v1.ts';

test('Lightscaper native Original retries the parent sync of an existing shard after failed directory durability', { skip: process.platform === 'win32' }, async () => {
	const root = await mkdtemp(join(tmpdir(), 'lightscaper native directory retry ü '));
	const closes: (() => Promise<void>)[] = [];
	let primary: unknown, failed = false;
	try {
		const paths = await prepareLightscaperNativeOriginalStorageCurrentV1(root);
		const bytes = Buffer.from('Actual native Original directory durability retry Ω.');
		const binding: LightscaperNativeOriginalBindingCurrentV1 = Object.freeze({ storageKey: 'directory-retry-original',
			contentSha256: createHash('sha256').update(bytes).digest('hex'), byteLength: bytes.length });
		const target = lightscaperNativePhotoOriginalBodyPathCurrentV1(paths, binding.contentSha256);
		const syncFailure = Object.freeze({ source: 'first-shard-parent-fsync-refused' });
		const events: string[] = []; let attempts = 0, producers = 0;
		const wrappedOpen: typeof open = async (...args: Parameters<typeof open>) => {
			const handle = await open(...args); closes.push(handle.close.bind(handle));
			if (String(args[0]) === paths.bodiesRoot) {
				const sync = handle.sync.bind(handle);
				Object.defineProperty(handle, 'sync', { value: async () => {
					attempts += 1;
					if (attempts === 1) { events.push('parent-sync-refused'); throw syncFailure; }
					await sync(); events.push('parent-sync-completed');
				} });
			}
			return handle;
		};
		const owner = new LightscaperNativeOriginalFilesCurrentV1(paths, wrappedOpen);
		const source: AsyncIterable<Uint8Array> = { [Symbol.asyncIterator]() {
			producers += 1; events.push('producer-admitted');
			return (async function* (): AsyncGenerator<Uint8Array> { yield new Uint8Array(bytes); })();
		} };
		await assert.rejects(owner.put(binding, source), (error: unknown) => { assert.equal(error, syncFailure); return true; });
		assert.equal((await lstat(dirname(target))).isDirectory(), true, 'The failed sync leaves a real shard for retry.');
		assert.equal(producers, 0); assert.deepEqual(await readdir(paths.stagingRoot), []);
		await owner.put(binding, source);
		assert.equal(attempts, 2, 'EEXIST must not discard the preceding parent-sync debt.');
		assert.deepEqual(events, ['parent-sync-refused', 'parent-sync-completed', 'producer-admitted']);
		assert.equal(producers, 1); assert.deepEqual(await readFile(target), bytes); await owner.retire();
	} catch (error) { failed = true; primary = error; }
	const cleanup = (await Promise.allSettled(closes.map(close => close()))).flatMap(result => result.status === 'rejected' ? [result.reason as unknown] : []);
	if (cleanup.length) throw new AggregateError([...(failed ? [primary] : []), ...cleanup], 'Native directory retry fixture handles did not retire; root retained.');
	await rm(root, { recursive: true, force: true });
	if (failed) throw primary;
});
