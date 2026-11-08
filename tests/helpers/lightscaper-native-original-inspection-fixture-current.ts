/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, open, rm, type FileHandle } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { TestContext } from 'node:test';
import { LightscaperNativePhotoMediaCurrentV1 as Media } from '../../desktop/lightscaper-native-photo-media-current-v1.ts';
import { deriveLightscaperNativePhotoOriginalPathsCurrentV1 as paths,
	lightscaperNativePhotoOriginalBodyPathCurrentV1 as bodyPath } from '../../desktop/lightscaper-native-original-index-current-v1.ts';
import type { CatalogOriginalRepairBindingV1 } from '../../src/common/editor/storage/media-catalog-original-repair-contract.ts';
import { deferred, remainsPending } from './async-test-control.ts';
export { assert, dirname, remainsPending };
export const INSPECTION_OPTIONS_CURRENT_V1 = { concurrency: false, timeout: 15_000 };
export interface InspectionFixtureCurrentV1 {
	readonly appDataPath: string; readonly media: Media; readonly db: DatabaseSync; readonly bytes: Uint8Array;
	readonly path: string; readonly paths: ReturnType<typeof paths>; readonly signal: AbortSignal;
	readonly binding: Readonly<CatalogOriginalRepairBindingV1>;
	inspect(binding?: unknown, options?: unknown): Promise<unknown>;
	track<T>(work: Promise<T>): Promise<T>;
	hold<T>(run: (gate: Readonly<{ entered: Promise<void>; release(): void }>) => Promise<T>): Promise<T>;
}

/** The real deadline releases accepted native reads and aborts inspections;
 * finally still joins the actual operation and each physical owner. */
export async function nativeOriginalInspectionFixtureCurrentV1(context: TestContext,
	run: (fixture: InspectionFixtureCurrentV1) => Promise<void>): Promise<void> {
	const stop = new AbortController(), releases = new Set<() => void>(), active = new Set<Promise<unknown>>();
	const cancel = (): void => { for (const release of releases) release(); stop.abort(context.signal.reason); };
	context.signal.addEventListener('abort', cancel, { once: true });
	let directory: string | undefined, media: Media | undefined, db: DatabaseSync | undefined, failed = false, primary: unknown;
	const track = <T>(work: Promise<T>): Promise<T> => {
		active.add(work); void work.then(() => { active.delete(work); }, () => { active.delete(work); }); return work;
	};
	try {
		directory = await mkdtemp(join(tmpdir(), 'lightscaper-native-original-inspection-'));
		media = await Media.open({ appDataPath: directory });
		if (context.signal.aborted) cancel(); context.signal.throwIfAborted();
		const bytes = new TextEncoder().encode('retained native Original inspection bytes\n'.repeat(512));
		const sha256 = createHash('sha256').update(bytes).digest('hex');
		const binding = Object.freeze({ catalogId: 'catalog', importId: null, photoId: 'photo', assetId: 'asset', sourceId: 'source',
			sha256, size: bytes.byteLength, name: 'Original.bin', mimeType: 'application/octet-stream' });
		await media.writeAsset('asset', new Blob([bytes]), { name: binding.name, mimeType: binding.mimeType });
		await media.catalogOriginals.retain('catalog', [{ photoId: 'photo', assetId: 'asset', sourceId: 'source', sha256, size: bytes.byteLength }]);
		const derived = paths(directory), physical = bodyPath(derived, sha256), actualMedia = media;
		db = new DatabaseSync(derived.databasePath);
		await run({ appDataPath: directory, media, db, bytes, paths: derived, path: physical, signal: stop.signal, binding, track,
			inspect: (input = binding, options = { signal: stop.signal }): Promise<unknown> => {
				const method: unknown = Reflect.get(actualMedia, 'inspectCatalogOriginalBody');
				assert.equal(typeof method, 'function', 'actual Native Media inspection capability must exist');
				return track(Promise.resolve(Reflect.apply(method as (...args: unknown[]) => unknown, actualMedia, [input, options])));
			},
			hold: async <T>(consume: (gate: Readonly<{ entered: Promise<void>; release(): void }>) => Promise<T>): Promise<T> => {
				const witness = await open(physical, 'r'), stamp = await witness.stat({ bigint: true });
				const prototype = Object.getPrototypeOf(witness) as object, descriptor = Object.getOwnPropertyDescriptor(prototype, 'read');
				assert.ok(descriptor && typeof descriptor.value === 'function'); const native = descriptor.value as FileHandle['read']; await witness.close();
				const entered = deferred<void>(), released = deferred<void>(); let held = false;
				const release = (): void => { released.resolve(); entered.resolve(); }; releases.add(release);
				Object.defineProperty(prototype, 'read', { ...descriptor, value: function (this: FileHandle, ...args: unknown[]) {
					const receipt = Reflect.apply(native, this, args) as ReturnType<FileHandle['read']>;
					return receipt.then(async value => {
						const actual = await this.stat({ bigint: true });
						if (!held && actual.dev === stamp.dev && actual.ino === stamp.ino) { held = true; entered.resolve(); await released.promise; }
						return value;
					});
				} });
				if (context.signal.aborted) release();
				try { return await consume({ entered: entered.promise, release }); }
				finally { release(); await Promise.allSettled([...active]); releases.delete(release); Object.defineProperty(prototype, 'read', descriptor); }
			},
		});
	} catch (error) { failed = true; primary = error; }
	context.signal.removeEventListener('abort', cancel);
	for (const release of releases) release(); stop.abort(new Error('Inspection fixture is retiring.'));
	await Promise.allSettled([...active]);
	const cleanup: unknown[] = [];
	try { await media?.close(); } catch (error) { cleanup.push(error); }
	try { db?.close(); } catch (error) { cleanup.push(error); }
	if (cleanup.length) throw new AggregateError([...(failed ? [primary] : []), ...cleanup], 'Inspection fixture retained files after failed native retirement.');
	if (directory) await rm(directory, { recursive: true, force: true });
	if (failed) throw primary;
}

export function replaceInspectionRootCurrentV1(db: DatabaseSync, photoId: string, change: (root: Record<string, unknown>) => void): void {
	const rows = db.prepare('SELECT root_key,root FROM native_photo_media_roots').all();
	for (const row of rows) {
		assert.equal(typeof row.root, 'string'); const value: unknown = JSON.parse(row.root as string);
		assert.ok(value && typeof value === 'object'); const root = value as Record<string, unknown>;
		if (root.photoId === photoId) { change(root); db.prepare('UPDATE native_photo_media_roots SET root=? WHERE root_key=?').run(JSON.stringify(root), row.root_key); return; }
	}
	assert.fail('Actual retained root was not found.');
}
