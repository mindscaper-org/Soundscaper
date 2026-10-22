/* SPDX-License-Identifier: AGPL-3.0-only */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { LightscaperNativeOriginalStoreCurrentV1 as Originals } from '../../desktop/lightscaper-native-original-store-current-v1.ts';
import { deriveLightscaperNativePhotoOriginalPathsCurrentV1 } from '../../desktop/lightscaper-native-original-index-current-v1.ts';
import { captureLightscaperNativePhotoMediaWriteCurrentV1 as capture,
	digestLightscaperNativePhotoMediaWriteCurrentV1 as digest,
	lightscaperNativePhotoMediaWriteChunksCurrentV1 as chunks } from '../../desktop/lightscaper-native-photo-media-blob-current-v1.ts';
import { installLightscaperNativePhotoMediaAssetCurrentV1 as install } from '../../desktop/lightscaper-native-photo-media-assets-current-v1.ts';

export interface NativeMediaAssetFixtureCurrentV1 { readonly appDataPath: string; readonly originals: Originals; readonly db: DatabaseSync }
export async function nativeMediaAssetFixtureCurrentV1(run: (f: NativeMediaAssetFixtureCurrentV1) => Promise<void>): Promise<void> {
	const appDataPath = await mkdtemp(join(tmpdir(), 'lightscaper-native-media-assets-'));
	let originals: Originals | undefined, db: DatabaseSync | undefined, failed = false, failure: unknown;
	try {
		originals = await Originals.open({ appDataPath });
		db = new DatabaseSync(deriveLightscaperNativePhotoOriginalPathsCurrentV1(appDataPath).databasePath);
		db.exec('PRAGMA foreign_keys=ON'); await run({ appDataPath, originals, db });
	} catch (error) { failed = true; failure = error; }
	const retired = await Promise.allSettled([originals?.close(), Promise.resolve().then(() => { db?.close(); })]);
	const cleanup = retired.flatMap(item => item.status === 'rejected' ? [item.reason as unknown] : []);
	if (cleanup.length) throw new AggregateError([...(failed ? [failure] : []), ...cleanup], 'Native media fixture retained files after retirement failure.');
	await rm(appDataPath, { recursive: true, force: true }); if (failed) throw failure;
}
export async function nativeMediaAssetPublicationCurrentV1(f: NativeMediaAssetFixtureCurrentV1, id = 'asset',
	body = new Blob(['actual immutable managed bytes']), metadata: Record<string, unknown> = { name: 'Original.png', mimeType: 'image/png' }) {
	const captured = await capture(id, body, metadata), binding = await digest(captured);
	const proof = await f.originals.storeBinding(binding, chunks(captured));
	return { captured, binding, proof, metadata: install(f.db, captured, proof) };
}
