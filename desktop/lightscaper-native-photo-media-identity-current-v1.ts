/* SPDX-License-Identifier: AGPL-3.0-only */
import type { DatabaseSync } from 'node:sqlite';
import type { LightscaperNativeOriginalBindingCurrentV1 as Binding } from './lightscaper-native-original-index-current-v1.ts';

/** Scalar FK composition only. Call after consuming the actual owning body
 * publication proof; this record independently grants no physical authority. */
export function ensureLightscaperNativeManagedPhotoMediaIdentityCurrentV1(database: DatabaseSync, binding: Readonly<Binding>): void {
	if (!database.isTransaction) throw new Error('Native Photo managed identity publication requires its owning transaction.');
	if (database.prepare('SELECT 1 FROM native_photo_linked_original_bindings WHERE storage_key=?').get(binding.storageKey)) {
		throw new Error('Native Photo source ID is already retained by a linked locator.');
	}
	if (!database.prepare('SELECT 1 FROM native_photo_media_identities WHERE source_id=?').get(binding.storageKey)) {
		const result = database.prepare(`INSERT INTO native_photo_media_identities(source_id,kind,sha256,size,managed_key,linked_key)
			VALUES(?,'managed',?,?,?,NULL)`).run(binding.storageKey, binding.contentSha256, binding.byteLength, binding.storageKey);
		if (result.changes !== 1) throw new Error('Native Photo managed identity was not published.');
	}
	assertLightscaperNativeManagedPhotoMediaIdentityCurrentV1(database, binding);
}

/** Fixed managed owner: a linked tuple cannot masquerade as its private body
 * binding. The later linked owner must perform genuine grant/handle admission. */
export function assertLightscaperNativeManagedPhotoMediaIdentityCurrentV1(database: DatabaseSync, binding: Readonly<Binding>): void {
	const row = database.prepare(`SELECT
		CASE WHEN typeof(source_id)='text' AND length(CAST(source_id AS BLOB))<=128 THEN source_id END AS source_id,
		CASE WHEN typeof(kind)='text' AND length(CAST(kind AS BLOB))<=16 THEN kind END AS kind,
		CASE WHEN typeof(sha256)='text' AND length(CAST(sha256 AS BLOB))=64 THEN sha256 END AS sha256,size,
		CASE WHEN typeof(managed_key)='text' AND length(CAST(managed_key AS BLOB))<=128 THEN managed_key END AS managed_key,
		linked_key IS NULL AS linked_absent FROM native_photo_media_identities WHERE source_id=?`).get(binding.storageKey);
	if (!row || row.source_id !== binding.storageKey || row.kind !== 'managed' || row.sha256 !== binding.contentSha256
		|| row.size !== binding.byteLength || row.managed_key !== binding.storageKey || row.linked_absent !== 1) {
		throw new Error('Native Photo asset has no matching typed managed identity.');
	}
}

/** Both published identity kinds retain exact immutable leaf tuples. This
 * scalar projection grants no file/body authority by itself. */
export const LIGHTSCAPER_NATIVE_PHOTO_MEDIA_IDENTITY_JOIN_CURRENT_V1 = `
 LEFT JOIN native_photo_media_identities i ON i.source_id=a.source_id
 LEFT JOIN native_photo_original_bindings b ON b.storage_key=i.managed_key
 LEFT JOIN native_photo_linked_original_bindings l ON l.storage_key=i.linked_key`;
export const LIGHTSCAPER_NATIVE_PHOTO_MEDIA_IDENTITY_COLUMNS_CURRENT_V1 = `
 CASE WHEN i.source_id=a.source_id AND i.sha256=a.sha256 AND i.size=a.size
 AND ((i.kind='managed' AND i.managed_key=a.source_id AND i.linked_key IS NULL AND b.storage_key=a.source_id AND b.content_sha256=a.sha256 AND b.byte_length=a.size)
 OR (i.kind='linked' AND i.linked_key=a.source_id AND i.managed_key IS NULL AND l.storage_key=a.source_id AND l.content_sha256=a.sha256 AND l.byte_length=a.size)) THEN i.kind END AS identity_kind`;
export function readLightscaperNativePhotoMediaIdentityCurrentV1(database: DatabaseSync,binding:Readonly<Binding>):'managed'|'linked'{
	const row=database.prepare(`SELECT ${LIGHTSCAPER_NATIVE_PHOTO_MEDIA_IDENTITY_COLUMNS_CURRENT_V1} FROM native_photo_media_assets a ${LIGHTSCAPER_NATIVE_PHOTO_MEDIA_IDENTITY_JOIN_CURRENT_V1} WHERE a.source_id=?`).get(binding.storageKey);
	if(!row||(row.identity_kind!=='managed'&&row.identity_kind!=='linked'))throw new Error('Native Photo lacks its exact typed media identity.');
	const asset=database.prepare("SELECT CASE WHEN typeof(sha256)='text' AND length(CAST(sha256 AS BLOB))=64 THEN sha256 END AS sha256,size FROM native_photo_media_assets WHERE source_id=?").get(binding.storageKey);
	if(asset?.sha256!==binding.contentSha256||asset.size!==binding.byteLength)throw new Error('Native Photo immutable typed media tuple differs.');return row.identity_kind;
}
