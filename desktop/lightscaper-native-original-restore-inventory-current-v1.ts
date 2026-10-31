/* SPDX-License-Identifier: AGPL-3.0-only */

import type { DatabaseSync } from 'node:sqlite';
import { setImmediate as nextTurn } from 'node:timers/promises';
import { LIGHTSCAPER_NATIVE_ORIGINAL_MAXIMUM_BYTES_CURRENT_V1 as MAXIMUM } from './lightscaper-native-original-contract-current-v1.ts';
import { LIGHTSCAPER_NATIVE_ORIGINAL_BODY_GENERATION_LIMIT_CURRENT_V1 as GENERATIONS } from './lightscaper-native-original-body-head-current-v1.ts';

/** Inventory includes retired/unpublished reservations as well as the active
 * heads authenticated with each asset. No unarchived digest can hide in these
 * tables while a restore claims a complete physical inventory. */
export async function auditLightscaperNativeOriginalRestoreInventoryCurrentV1(db: DatabaseSync,
	visit: (row: Readonly<Record<string, unknown>>) => void, current: () => void): Promise<void> {
	current();
	for (const table of ['native_photo_original_body_locators', 'native_photo_original_body_heads']) {
		if (db.prepare(`SELECT 1 FROM ${table} l WHERE NOT EXISTS(SELECT 1 FROM native_photo_original_bindings b
			WHERE b.content_sha256=l.content_sha256 AND b.byte_length=l.byte_length) LIMIT 1`).get()) {
			throw new Error('Native restore Original locator/head inventory contains an unarchived digest.');
		}
	}
	let afterSha: string | undefined, afterId: string | undefined, lastSha: string | undefined, generations = 0;
	for (;;) {
		current(); const rows = db.prepare(`SELECT
			CASE WHEN typeof(content_sha256)='text' AND length(CAST(content_sha256 AS BLOB))=64 THEN content_sha256 END AS sha,
			CASE WHEN typeof(locator_id)='text' AND length(CAST(locator_id AS BLOB))<=64 THEN locator_id END AS id,
			byte_length AS bytes,CASE WHEN typeof(layout)='text' AND length(CAST(layout AS BLOB))<=32 THEN layout END AS layout
			FROM native_photo_original_body_locators${afterSha ? ' WHERE (content_sha256,locator_id)>(?,?)' : ''}
			ORDER BY content_sha256,locator_id LIMIT 64`).all(...(afterSha ? [afterSha, afterId!] : []));
		for (const row of rows) {
			if (typeof row.sha !== 'string' || !/^[a-f0-9]{64}$/u.test(row.sha) || typeof row.id !== 'string'
				|| typeof row.bytes !== 'number' || !Number.isSafeInteger(row.bytes) || row.bytes < 1 || row.bytes > MAXIMUM
				|| !(row.id === 'legacy' ? row.layout === 'legacy-sha-v1' : /^[a-f0-9]{64}$/u.test(row.id) && row.layout === 'generation-v1')) {
				throw new TypeError('Native restore Original locator inventory is malformed.');
			}
			if (lastSha !== row.sha) { lastSha = row.sha; generations = 0; }
			if (row.layout === 'generation-v1' && ++generations > GENERATIONS) throw new Error('Native restore Original generation inventory exceeds its debt bound.');
			visit(row); afterSha = row.sha; afterId = row.id;
		}
		if (rows.length < 64) break;
		await nextTurn(); current();
	}
	current();
}
