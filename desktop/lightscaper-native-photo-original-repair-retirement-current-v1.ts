/* SPDX-License-Identifier: AGPL-3.0-only */

import type { DatabaseSync } from 'node:sqlite';
import { MediaPublicationReconciliationError } from '../src/common/editor/storage/media-asset-owned-publication.ts';

const unretired = new WeakMap<DatabaseSync, unknown>();

/** Call only from the catch of this repair's own successfully begun SQL
 * transaction. An actual failed rollback with a still-active/unknown native
 * transaction latches retirement failure; arbitrary caller errors cannot. */
export function rollbackLightscaperNativePhotoOriginalRepairCurrentV1(db: DatabaseSync, primary: unknown): boolean {
	if (!db.isTransaction) return false;
	try { db.exec('ROLLBACK'); return true; }
	catch (cleanup) {
		const failure = new MediaPublicationReconciliationError(primary, cleanup);
		let active = true;
		try { active = db.isTransaction; } catch { /* No real retirement acknowledgment exists. */ }
		if (active) unretired.set(db, failure);
		throw failure;
	}
}

export function hasLightscaperNativePhotoOriginalRepairRetirementFailureCurrentV1(db: DatabaseSync): boolean { return unretired.has(db); }
export function assertLightscaperNativePhotoOriginalRepairRetiredCurrentV1(db: DatabaseSync): void {
	if (unretired.has(db)) throw unretired.get(db);
}
