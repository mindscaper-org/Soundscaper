/* SPDX-License-Identifier: AGPL-3.0-only */
import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { nativeRepairSourceFixtureCurrentV1 as fixture, repairSourceOptionsCurrentV1 as options,
	assert, remainsPending } from './helpers/lightscaper-native-original-repair-source-fixture-current.ts';
const sha = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

void test('Lightscaper repair source uses actual completed upload bytes and the full exact publication kernel', options, async t => {
	await fixture(t, async f => {
		const before = f.db.prepare('SELECT media_content_token,metadata,committed_at,pending_until FROM native_photo_media_assets').get(); assert.ok(before);
		const beforeDigest = sha(before.metadata as Uint8Array);
		const uploaded = await f.upload(); const corrupt = new Uint8Array(f.bytes); corrupt[0] = (corrupt[0] ?? 0) ^ 1; await writeFile(f.path, corrupt);
		assert.deepEqual(await f.repair(uploaded.proof), { assetId: f.binding.assetId, sha256: f.binding.sha256, size: f.binding.size });
		assert.deepEqual(await f.inspect(), { status: 'present' });
		const after = f.db.prepare('SELECT media_content_token,metadata,committed_at,pending_until FROM native_photo_media_assets').get(); assert.ok(after);
		assert.equal(after.media_content_token, before.media_content_token); assert.equal(sha(after.metadata as Uint8Array), beforeDigest);
		assert.equal(after.committed_at, before.committed_at); assert.equal(after.pending_until, before.pending_until);
		assert.equal(sha(new Uint8Array(await readFile(f.path))), sha(corrupt));
		assert.equal((await readdir(f.paths.stagingRoot)).length, 0);
	});
});

void test('Lightscaper upload snapshots actual native chunks before awaiting file work', options, async t => {
	await fixture(t, async f => {
		const owner = await f.begin(), borrowed = new Uint8Array(f.bytes); const writing = f.track(owner.write(borrowed)); borrowed.fill(0);
		await writing; assert.deepEqual(await f.repair(await f.track(owner.finish())), { assetId: f.binding.assetId, sha256: f.binding.sha256, size: f.binding.size });
	});
});

void test('Lightscaper wrong upload SHA and short body refuse before any locator reservation', options, async t => {
	await fixture(t, async f => {
		for (const short of [false, true]) {
			const owner = await f.begin(), bytes = new Uint8Array(f.bytes); if (short) await owner.write(bytes.subarray(0, bytes.length - 1));
			else { bytes[0] = (bytes[0] ?? 0) ^ 1; await owner.write(bytes); }
			await assert.rejects(f.track(owner.finish())); await owner.close();
		}
		assert.equal(f.db.prepare('SELECT count(*) AS n FROM native_photo_original_body_locators').get()?.n, 0);
		assert.equal((await readdir(f.paths.stagingRoot)).length, 0);
	});
});

void test('Lightscaper completed upload proof rejects foreign namespace without consuming its correct source', options, async t => {
	await fixture(t, async f => {
		const { proof } = await f.upload();
		const module = await import('../desktop/lightscaper-native-photo-upload-file-current-v1.ts');
		const foreign = new DatabaseSync(join(f.appDataPath, 'foreign.sqlite3'));
		try { assert.throws(() => module.consumeLightscaperNativePhotoUploadFileCurrentV1(proof, foreign)); }
		finally { foreign.close(); }
		assert.deepEqual(await f.repair(proof), { assetId: f.binding.assetId, sha256: f.binding.sha256, size: f.binding.size });
	});
});

void test('Lightscaper completed upload proof refuses descriptors, proxies and replay without borrower reflection', options, async t => {
	await fixture(t, async f => {
		const { proof } = await f.upload(); let reflected = 0;
		for (const value of [{ byteLength: f.binding.size, contentSha256: f.binding.sha256 }, new Proxy(proof, { ownKeys() { reflected++; throw new Error('Reflected fake proof.'); } })])
			await assert.rejects(f.repair(value));
		assert.equal(reflected, 0); await f.repair(proof); await assert.rejects(f.repair(proof));
		assert.equal(f.db.prepare('SELECT count(*) AS n FROM native_photo_original_body_heads').get()?.n, 1);
	});
});

void test('Lightscaper upload file reads are real bounded rewindable owned copies', options, async t => {
	await fixture(t, async f => {
		const { proof } = await f.upload(); const module = await import('../desktop/lightscaper-native-photo-upload-file-current-v1.ts');
		const view = module.consumeLightscaperNativePhotoUploadFileCurrentV1(proof, f.db);
		try {
			const first = await f.track(view.read(0, f.bytes.byteLength)); assert.equal(sha(first), f.binding.sha256); first.fill(0);
			const next = await f.track(view.read(0, f.bytes.byteLength)); assert.equal(sha(next), f.binding.sha256);
			await assert.rejects(view.read(0, 1_048_577)); await assert.rejects(view.read(f.bytes.byteLength, 1));
		} finally { await view.close(); }
		await assert.rejects(view.read(0, 1));
	});
});

void test('Lightscaper source repair closes actual upload before head publication', options, async t => {
	await fixture(t, async f => {
		const { proof } = await f.upload();
		await f.gate('close', async gate => {
			const work = f.repair(proof); void work.catch(() => undefined);
			try { await gate.entered; t.signal.throwIfAborted();
				assert.equal(f.db.prepare('SELECT count(*) AS n FROM native_photo_original_body_heads').get()?.n, 0);
				assert.equal(await remainsPending(work), true); gate.release(); await work;
			} finally { gate.release(); await Promise.allSettled([work]); }
		});
		assert.deepEqual(await f.inspect(), { status: 'present' });
	});
});

void test('Lightscaper Media close joins held actual upload source IO and keeps opaque cancellation local', options, async t => {
	await fixture(t, async f => {
		const { proof } = await f.upload(); const caller = new AbortController(), reason = Symbol('actual source pull cancelled');
		await f.gate('read', async gate => {
			const work = f.repair(proof, f.binding, caller.signal); const observed = work.then(() => { assert.fail('Cancelled source repair succeeded.'); }, actual => { assert.equal(actual, reason); });
			let closing: Promise<void> | undefined;
			try { await gate.entered; t.signal.throwIfAborted(); caller.abort(reason); closing = f.media.close();
				assert.equal(await remainsPending(work), true); assert.equal(await remainsPending(closing), true); gate.release(); await observed; await closing;
			} finally { gate.release(); await Promise.allSettled([work, observed, ...(closing ? [closing] : [])]); }
		});
		assert.equal(f.db.prepare('SELECT count(*) AS n FROM native_photo_original_body_locators').get()?.n, 0);
	});
});

void test('Lightscaper source capture failure retires the actual consumed upload before allowing retry', options, async t => {
	await fixture(t, async f => {
		const { proof } = await f.upload(), reason = Symbol('borrowed binding refused');
		const binding = new Proxy(f.binding, { ownKeys() { throw reason; } });
		await f.repair(proof, binding).then(() => { assert.fail('Borrowed binding should refuse.'); }, actual => { assert.equal(actual, reason); });
		assert.equal((await readdir(f.paths.stagingRoot)).length, 0);
		await assert.rejects(f.repair(proof)); const retry = await f.upload(); await f.repair(retry.proof);
	});
});

void test('Lightscaper repair upload capacity is shared and reclaimed after real consumed and unconsumed close', options, async t => {
	await fixture(t, async f => {
		const owners = [];
		try {
			for (let count = 0; count < 16; count++) { t.signal.throwIfAborted(); owners.push(await f.begin()); }
			let reflected = 0; const input = new Proxy({}, { ownKeys() { reflected++; throw new Error('Full upload capacity reflected options.'); } });
			await assert.rejects(f.begin(input)); assert.equal(reflected, 0);
		} finally { await Promise.all(owners.map(owner => owner.close())); }
		const retry = await f.upload(); await f.repair(retry.proof); const last = await f.begin(); await last.close();
		assert.equal((await readdir(f.paths.stagingRoot)).length, 0);
	});
});

void test('Lightscaper source repair retains genuine head COMMIT ACK after late cancellation', options, async t => {
	await fixture(t, async f => {
		const { proof } = await f.upload(), caller = new AbortController();
		const descriptor = Object.getOwnPropertyDescriptor(DatabaseSync.prototype, 'exec'); assert.ok(descriptor && typeof descriptor.value === 'function');
		const native = descriptor.value as DatabaseSync['exec']; let committed = false;
		Object.defineProperty(DatabaseSync.prototype, 'exec', { ...descriptor, value: function (this: DatabaseSync, sql: string) {
			const head = sql === 'COMMIT' && this.isTransaction && this.prepare('SELECT 1 FROM native_photo_original_body_heads LIMIT 1').get();
			const value = Reflect.apply(native, this, [sql]); if (head) { committed = true; caller.abort(Symbol('after genuine repair COMMIT')); } return value;
		} });
		try { assert.deepEqual(await f.repair(proof, f.binding, caller.signal), { assetId: f.binding.assetId, sha256: f.binding.sha256, size: f.binding.size }); }
		finally { Object.defineProperty(DatabaseSync.prototype, 'exec', descriptor); }
		assert.equal(committed, true); assert.deepEqual(await f.inspect(), { status: 'present' });
	});
});
