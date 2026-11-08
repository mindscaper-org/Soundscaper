/* SPDX-License-Identifier: AGPL-3.0-only */

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Worker } from 'node:worker_threads';
import type { NativeInspectionQuarantineReportCurrentV1 } from './helpers/lightscaper-native-inspection-quarantine-current.ts';
import { LightscaperNativePhotoMediaCurrentV1 as Media } from '../desktop/lightscaper-native-photo-media-current-v1.ts';
import { assertLightscaperNativePhotoOriginalUnpinnedCurrentV1 as unpinned } from '../desktop/lightscaper-native-photo-original-read-pins-current-v1.ts';
import { assert, nativeOriginalInspectionFixtureCurrentV1 as fixture,
	INSPECTION_OPTIONS_CURRENT_V1 as options } from './helpers/lightscaper-native-original-inspection-fixture-current.ts';

void test('Lightscaper native inspection refuses shared four-read capacity before physical IO', options, async t => {
	await fixture(t, async f => {
		const other = await Media.open({ appDataPath: f.appDataPath });
		const slots = Array.from({ length: 4 }, () => other.reserveOriginalRead());
		try { await f.hold(async gate => {
			await assert.rejects(f.inspect());
			let entered = false; void gate.entered.then(() => { entered = true; });
			await Promise.resolve(); assert.equal(entered, false);
		}); } finally { for (const slot of slots) slot.release(); await other.close(); }
		assert.deepEqual(await f.inspect(), { status: 'present' });
	});
});

void test('Lightscaper native held inspection pins the actual asset across independently opened Media owners', options, async t => {
	await fixture(t, async f => {
		const other = await Media.open({ appDataPath: f.appDataPath });
		try { await f.hold(async gate => {
			const work = f.inspect(); void work.catch(() => undefined);
			const stored = f.db.prepare('SELECT root_key,scope_key,asset_id,root FROM native_photo_media_roots').get(); assert.ok(stored);
			try {
				await gate.entered; assert.throws(() => { unpinned(f.db, 'asset'); });
				f.db.exec('DELETE FROM native_photo_media_roots; UPDATE native_photo_media_assets SET root_count=0');
				await assert.rejects(other.deleteAsset('asset'));
			} finally {
				f.db.prepare('INSERT OR REPLACE INTO native_photo_media_roots(root_key,scope_key,asset_id,root) VALUES(?,?,?,?)')
					.run(stored.root_key, stored.scope_key, stored.asset_id, stored.root);
				f.db.exec('UPDATE native_photo_media_assets SET root_count=1'); gate.release();
			}
			assert.deepEqual(await work, { status: 'present' }); unpinned(f.db, 'asset');
		}); } finally { await other.close(); }
	});
});

/** Permanent quarantine is isolated from the parent's namespace registry.
 * The worker still performs/join real FS reads and actual close afterward. */
void test('Lightscaper native inspection close failure preserves both causes, pin and read capacity until restart', options, async t => {
	const appDataPath = await mkdtemp(join(tmpdir(), 'lightscaper-inspection-quarantine-'));
	let worker: Worker | undefined, received: Partial<NativeInspectionQuarantineReportCurrentV1> | undefined, workerFailed: unknown, exited = false;
	const abort = (): void => { if (worker && !exited) void worker.terminate().catch(() => undefined); };
	t.signal.addEventListener('abort', abort, { once: true });
	try {
		worker = new Worker(new URL('./helpers/lightscaper-native-inspection-quarantine-current.ts', import.meta.url), {
			execArgv: ['--import', import.meta.resolve('tsx')], resourceLimits: { maxOldGenerationSizeMb: 96 }, workerData: { appDataPath },
		});
		const current = worker;
		const exit = new Promise<number>(resolve => {
			current.on('message', (value: unknown) => { if (value && typeof value === 'object') received = value as Partial<NativeInspectionQuarantineReportCurrentV1>; });
			current.on('error', (error: unknown) => { workerFailed = error; });
			current.once('exit', code => { exited = true; resolve(code); });
		});
		if (t.signal.aborted) abort();
		const code = await exit;
		if (workerFailed !== undefined) throw workerFailed;
		assert.equal(code, 0, JSON.stringify(received));
		assert.deepEqual(received, { causes: true, pin: true, capacity: true, closeRefused: true });
	} finally {
		t.signal.removeEventListener('abort', abort);
		if (worker && !exited) await worker.terminate();
		await rm(appDataPath, { recursive: true, force: true });
	}
});
