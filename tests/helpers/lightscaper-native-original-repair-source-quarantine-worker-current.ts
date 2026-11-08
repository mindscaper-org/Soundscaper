/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { open, type FileHandle } from 'node:fs/promises';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { parentPort, workerData } from 'node:worker_threads';
import { LightscaperNativePhotoMediaCurrentV1 as Media } from '../../desktop/lightscaper-native-photo-media-current-v1.ts';
import { deriveLightscaperNativePhotoOriginalPathsCurrentV1 as paths } from '../../desktop/lightscaper-native-original-index-current-v1.ts';
export interface LightscaperOriginalRepairWorkerInputCurrentV1 { readonly appDataPath: string }
const { appDataPath } = workerData as LightscaperOriginalRepairWorkerInputCurrentV1;
const media = await Media.open({ appDataPath }), bytes = new TextEncoder().encode('real repair upload close quarantine');
const sha256 = createHash('sha256').update(bytes).digest('hex');
await media.writeAsset('asset', new Blob([bytes]), { name: 'Original.bin', mimeType: 'application/octet-stream' });
await media.catalogOriginals.retain('catalog', [{ photoId: 'photo', assetId: 'asset', sourceId: 'source', sha256, size: bytes.byteLength }]);
const upload = await media.beginOriginalRepairUploadCurrentV1({ expectedBytes: bytes.byteLength, expectedSha256: sha256 });
await upload.write(bytes); const proof = await upload.finish();
const witness = await open(join(paths(appDataPath).stagingRoot, 'close-witness'), 'wx');
const prototype = Object.getPrototypeOf(witness) as object, descriptor = Object.getOwnPropertyDescriptor(prototype, 'read'); await witness.close();
assert.ok(descriptor && typeof descriptor.value === 'function'); const native = descriptor.value as FileHandle['read'];
let armed = true, actualClose = false;
Object.defineProperty(prototype, 'read', { ...descriptor, value: function (this: FileHandle, ...args: unknown[]) {
	const work = Reflect.apply(native, this, args) as ReturnType<FileHandle['read']>;
	if (armed) {
		armed = false; const close = this.close;
		Object.defineProperty(this, 'close', { configurable: true, value: async function (this: FileHandle): Promise<void> {
			await Reflect.apply(close, this, []); actualClose = true; throw new Error('Actual upload FD close receipt refused.');
		} });
	}
	return work;
} });
let refused = false, busy = false, reflected = 0, closeRefused = false;
try {
	try { await media.restoreCatalogOriginalBodyFromSourceCurrentV1({ catalogId: 'catalog', importId: null, photoId: 'photo', assetId: 'asset', sourceId: 'source', sha256,
		size: bytes.byteLength, name: 'Original.bin', mimeType: 'application/octet-stream' }, proof); } catch { refused = true; }
	try { await media.beginOriginalRepairUploadCurrentV1(new Proxy({ expectedBytes: bytes.byteLength, expectedSha256: sha256 }, {
		ownKeys() { reflected++; throw new Error('Quarantine reflected borrowed options.'); }
	})); } catch { busy = true; }
	try { await media.close(); } catch { closeRefused = true; }
} finally { Object.defineProperty(prototype, 'read', descriptor); }
const reader = new DatabaseSync(paths(appDataPath).databasePath, { readOnly: true });
let heads: unknown;
try { heads = reader.prepare('SELECT count(*) AS n FROM native_photo_original_body_heads').get()?.n; } finally { reader.close(); }
parentPort?.postMessage({ refused, actualClose, busy, reflected, closeRefused, heads }); parentPort?.close();
