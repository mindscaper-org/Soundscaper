/* SPDX-License-Identifier: AGPL-3.0-only */

import type { DatabaseSync } from 'node:sqlite';
import type { CatalogOriginalRepairBindingV1, CatalogOriginalRepairReceiptV1 } from '../src/common/editor/storage/media-catalog-original-repair-contract.ts';
import { PENDING_SOURCE_RETENTION_MS } from '../src/common/editor/storage/source-write-common.ts';
import { MediaPublicationReconciliationError } from '../src/common/editor/storage/media-asset-owned-publication.ts';
import { readLightscaperNativePhotoOriginalRepairStateCurrentV1 as state,
	type LightscaperNativePhotoOriginalRepairStateCurrentV1 as State } from './lightscaper-native-photo-original-repair-custody-current-v1.ts';
import { consumeLightscaperNativeOriginalRepairPublicationCurrentV1 as consume } from './lightscaper-native-original-store-current-v1.ts';
import { switchLightscaperNativeOriginalBodyHeadCurrentV1 as switchHead,
	readLightscaperNativeOriginalBodyHeadCurrentV1 as readHead, type LightscaperNativeOriginalBodyHeadCurrentV1 as Head } from './lightscaper-native-original-body-head-current-v1.ts';
import { checkLightscaperNativePhotoMediaSignalCurrentV1 as check } from './lightscaper-native-photo-media-lifetime-current-v1.ts';
import { readLightscaperNativePhotoMediaWriteCurrentV1, type LightscaperNativePhotoMediaWriteCurrentV1 as Write } from './lightscaper-native-photo-media-blob-current-v1.ts';
import { rollbackLightscaperNativePhotoOriginalRepairCurrentV1 as rollback } from './lightscaper-native-photo-original-repair-retirement-current-v1.ts';

const NativeDate = Date, NOW = Date.now, ISO = Date.prototype.toISOString;

/** All body IO has joined before this transaction. Only a genuine one-use
 * fresh-file proof can move the shared digest head. Existing descriptive
 * metadata remains in SQLite, so concurrent harmless edits are preserved. */
export function publishLightscaperNativePhotoOriginalRepairCurrentV1(db: DatabaseSync,
	binding: Readonly<CatalogOriginalRepairBindingV1>, before: Readonly<State>, captured: Write, proof: unknown,
	signal?: AbortSignal): Readonly<CatalogOriginalRepairReceiptV1> {
	if (db.isTransaction) throw new Error('Native Original repair publication requires an idle database.');
	check(signal); db.exec('BEGIN IMMEDIATE');
	let candidate: Readonly<Head> | undefined, attemptedCommit = false;
	try {
		const current = state(db, binding, signal); assertSame(current, before);
		const physical = consume(proof, db);
		if (physical.binding.storageKey !== binding.assetId || physical.binding.byteLength !== binding.size
			|| physical.binding.contentSha256 !== binding.sha256 || JSON.stringify(physical.expectedHead) !== JSON.stringify(before.head)) {
			throw new Error('Native Original repair proof differs from the captured retained Original.');
		}
		if (current.binding === null) {
			db.prepare('INSERT INTO native_photo_original_bindings(storage_key,content_sha256,byte_length) VALUES(?,?,?)').run(binding.assetId, binding.sha256, binding.size);
		}
		if (current.asset === null) {
			const payload = readLightscaperNativePhotoMediaWriteCurrentV1(captured).metadataPayload;
			const now = NOW(), committed = Reflect.apply(ISO, new NativeDate(now), []) as string;
			const pending = Reflect.apply(ISO, new NativeDate(now + PENDING_SOURCE_RETENTION_MS), []) as string;
			db.prepare(`INSERT INTO native_photo_media_assets(source_id,sha256,size,media_content_token,metadata,root_count,committed_at,pending_until)
				VALUES(?,?,?,?,?,?,?,?)`).run(binding.assetId, binding.sha256, binding.size, current.root.mediaContentToken, payload, current.count, committed, pending);
		} else db.prepare('UPDATE native_photo_media_assets SET root_count=? WHERE source_id=?').run(current.count, binding.assetId);
		candidate = switchHead(db, physical.binding, before.head, physical.locatorId);
		const published = state(db, binding, signal);
		if (JSON.stringify(published.root) !== JSON.stringify(before.root) || published.asset?.token !== before.root.mediaContentToken
			|| !published.binding || JSON.stringify(published.head) !== JSON.stringify(candidate) || published.count !== current.count) {
			throw new Error('Native Original repair publication changed before acknowledgment.');
		}
		check(signal); attemptedCommit = true; db.exec('COMMIT');
		return receipt(binding);
	} catch (primary) {
		const rolledBack = rollback(db, primary);
		if (!candidate || !attemptedCommit || rolledBack) throw primary;
		// A thrown post-COMMIT receipt is not proof of rollback. Authenticate the
		// exact candidate in a fresh transaction; unknown/superseded files remain
		// reserved and protected, never deleted by an error handler.
		try {
			db.exec('BEGIN');
			const actual = state(db, binding), head = readHead(db, { storageKey: binding.assetId, contentSha256: binding.sha256, byteLength: binding.size });
			const committed = JSON.stringify(head) === JSON.stringify(candidate) && JSON.stringify(actual.root) === JSON.stringify(before.root)
				&& actual.asset?.token === before.root.mediaContentToken && actual.binding !== null;
			db.exec('COMMIT');
			if (committed) return receipt(binding);
			throw new Error('Native Original repair acknowledgment is uncertain; its fresh body remains protected.', { cause: primary });
		} catch (reconciliation) {
			try { rollback(db, reconciliation); }
			catch (retirement) { throw new MediaPublicationReconciliationError(primary, retirement); }
			throw new MediaPublicationReconciliationError(primary, reconciliation);
		}
	}
}
function assertSame(actual: Readonly<State>, expected: Readonly<State>): void {
	if (JSON.stringify(actual.root) !== JSON.stringify(expected.root) || JSON.stringify(actual.asset) !== JSON.stringify(expected.asset)
		|| JSON.stringify(actual.binding) !== JSON.stringify(expected.binding) || JSON.stringify(actual.head) !== JSON.stringify(expected.head)) {
		throw new Error('Native Original media identity, selected custody or physical head changed before repair.');
	}
}
function receipt(binding: Readonly<CatalogOriginalRepairBindingV1>): Readonly<CatalogOriginalRepairReceiptV1> {
	return Object.freeze({ assetId: binding.assetId, sha256: binding.sha256, size: binding.size });
}
