/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { initializeHistoricalLightscaperOriginalV1Current } from './lightscaper-native-original-v1-fixture-current.ts';
import { initializeHistoricalLightscaperOriginalV2Current } from './lightscaper-native-original-v2-fixture-current.ts';
import { initializeHistoricalLightscaperOriginalV3Current } from './lightscaper-native-original-v3-fixture-current.ts';
export { originalHeadFixtureCurrentV1 as linkedSchemaFixtureCurrentV1, ORIGINAL_HEAD_TEST_OPTIONS_CURRENT_V1 as LINKED_SCHEMA_OPTIONS_CURRENT_V1 } from './lightscaper-native-original-head-fixture-current.ts';

export const LINKED_SCHEMA_SHA_CURRENT_V1 = 'a'.repeat(64), LINKED_SCHEMA_OTHER_SHA_CURRENT_V1 = 'b'.repeat(64);
export const LINKED_SCHEMA_TOKEN_CURRENT_V1 = 'media-content-0123456789abcdef';
export const linkedSchemaObjectsCurrentV1 = (db: DatabaseSync) => db.prepare("SELECT type,name,sql FROM sqlite_schema WHERE name NOT GLOB 'sqlite_*' ORDER BY type,name").all();
export const linkedSchemaHashCurrentV1 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

/** These rows prove migration and SQL constraints only. They grant no actual
 * managed/linked body, Photo/custody, decoder, native root or file authority. */
export function seedHistoricalLinkedSchemaCurrentV1(db: DatabaseSync, version: 1 | 2 | 3, large = false): void {
	(version === 1 ? initializeHistoricalLightscaperOriginalV1Current : version === 2 ? initializeHistoricalLightscaperOriginalV2Current : initializeHistoricalLightscaperOriginalV3Current)(db);
	db.exec('PRAGMA foreign_keys=ON');
	const binding = db.prepare('INSERT INTO native_photo_original_bindings VALUES(?,?,?)');
	binding.run('published', LINKED_SCHEMA_SHA_CURRENT_V1, 3); binding.run('pending', LINKED_SCHEMA_OTHER_SHA_CURRENT_V1, 5); binding.run('orphan', 'c'.repeat(64), 7);
	if (version === 1) return;
	const metadata = large ? new Uint8Array(2 * 1024 * 1024).fill(165) : Uint8Array.of(0, 255, 65, 0, 216, 0);
	try {
		insertLinkedSchemaAssetCurrentV1(db, 'published', LINKED_SCHEMA_SHA_CURRENT_V1, 3, 2, Uint8Array.of(0, 1, 255));
		insertLinkedSchemaAssetCurrentV1(db, 'pending', LINKED_SCHEMA_OTHER_SHA_CURRENT_V1, 5, 0, metadata);
	} finally { metadata.fill(0); }
	const root = db.prepare('INSERT INTO native_photo_media_roots VALUES(?,?,?,?)');
	root.run(Uint8Array.of(0, 0, 216, 0, 255, 255), Uint8Array.of(0, 1), 'published', '{"role":"permanent"}');
	root.run(Uint8Array.of(0, 0, 216, 1, 255, 255), Uint8Array.of(0, 2), 'published', '{"role":"staged"}');
	if (version === 3) {
		const locator = db.prepare('INSERT INTO native_photo_original_body_locators VALUES(?,?,?,?)');
		locator.run(LINKED_SCHEMA_SHA_CURRENT_V1, 'legacy', 3, 'legacy-sha-v1');
		locator.run(LINKED_SCHEMA_SHA_CURRENT_V1, 'd'.repeat(64), 3, 'generation-v1');
		locator.run(LINKED_SCHEMA_SHA_CURRENT_V1, 'e'.repeat(64), 3, 'generation-v1');
		db.prepare('INSERT INTO native_photo_original_body_heads VALUES(?,?,?,?)').run(LINKED_SCHEMA_SHA_CURRENT_V1, 'd'.repeat(64), 3, 7);
	}
}

export function insertLinkedSchemaAssetCurrentV1(db: DatabaseSync, key: string, sha: string, size: number, count = 0, metadata: Uint8Array = Uint8Array.of(1)): void {
	db.prepare('INSERT INTO native_photo_media_assets VALUES(?,?,?,?,?,?,?,?)').run(key, sha, size, LINKED_SCHEMA_TOKEN_CURRENT_V1,
		metadata, count, '2026-10-18T12:00:00.000Z', '2026-10-19T12:00:00.000Z');
}

export function insertLinkedSchemaIdentityCurrentV1(db: DatabaseSync, key: string, kind: 'managed' | 'linked', sha = LINKED_SCHEMA_SHA_CURRENT_V1, size = 3): void {
	db.prepare('INSERT INTO native_photo_media_identities(source_id,kind,sha256,size,managed_key,linked_key) VALUES(?,?,?,?,?,?)')
		.run(key, kind, sha, size, kind === 'managed' ? key : null, kind === 'linked' ? key : null);
}
export function insertLinkedSchemaLeafCurrentV1(db: DatabaseSync, key: string, bytes: Uint8Array = Uint8Array.of(83, 67, 1, 0, 216, 0, 255)): void {
	db.prepare('INSERT INTO native_photo_linked_original_bindings(storage_key,content_sha256,byte_length,grant_id,locator_id,revision,locator) VALUES(?,?,?,?,?,?,?)')
		.run(key, LINKED_SCHEMA_SHA_CURRENT_V1, 3, '1'.repeat(64), '2'.repeat(64), 0, bytes);
}

export function linkedSchemaRowsCurrentV1(db: DatabaseSync, version: 1 | 2 | 3 | 4) {
	const assets = version === 1 ? [] : db.prepare('SELECT * FROM native_photo_media_assets ORDER BY source_id').all().map(row => {
		assert.ok(row.metadata instanceof Uint8Array);
		return { ...row, metadata: { byteLength: row.metadata.byteLength, sha256: linkedSchemaHashCurrentV1(row.metadata) } };
	});
	return { bindings: db.prepare('SELECT * FROM native_photo_original_bindings ORDER BY storage_key').all(), assets,
		roots: version === 1 ? [] : db.prepare('SELECT hex(root_key) AS root_key,hex(scope_key) AS scope_key,asset_id,root FROM native_photo_media_roots ORDER BY root_key').all(),
		locators: version < 3 ? [] : db.prepare('SELECT * FROM native_photo_original_body_locators ORDER BY content_sha256,locator_id').all(),
		heads: version < 3 ? [] : db.prepare('SELECT * FROM native_photo_original_body_heads ORDER BY content_sha256').all() };
}
