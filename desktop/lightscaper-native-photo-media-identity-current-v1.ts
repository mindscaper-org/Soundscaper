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
