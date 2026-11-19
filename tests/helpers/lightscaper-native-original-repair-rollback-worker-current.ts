/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { constants, DatabaseSync } from 'node:sqlite';
import { isMainThread, parentPort, workerData } from 'node:worker_threads';
import { LightscaperNativePhotoMediaCurrentV1 as Media } from '../../desktop/lightscaper-native-photo-media-current-v1.ts';
import { deriveLightscaperNativePhotoOriginalPathsCurrentV1 as paths } from '../../desktop/lightscaper-native-original-index-current-v1.ts';

export interface NativeOriginalRepairRollbackReportCurrentV1 {
	readonly commitDenied: boolean;
	readonly rollbackDenied: boolean;
	readonly transactionRetained: boolean;
	readonly repairRejected: boolean;
	readonly secondRepairBusy: boolean;
	readonly borrowedReflections: number;
	readonly closeRejected: boolean;
	readonly actualPrivateCloseAttempted: boolean;
	readonly commitCompleted?: boolean;
	readonly reconciliationReadDenied?: boolean;
	readonly originalPrimaryPreserved?: boolean;
	readonly readFailurePreserved?: boolean;
	readonly rollbackFailurePreserved?: boolean;
}

/** Only inspect the deliberately owned AggregateError arrays; opaque scalar
 * reasons are compared by identity, never stringified or reflected. */
function containsAggregateLeaf(value: unknown, expected: unknown): boolean {
	const pending = [value], seen = new Set<object>(); let steps = 0;
	while (pending.length && ++steps <= 64) {
		const next: unknown = pending.pop();
		if (Object.is(next, expected)) return true;
		if (!(next instanceof AggregateError) || seen.has(next)) continue;
		seen.add(next); const children: unknown = Object.getOwnPropertyDescriptor(next, 'errors')?.value;
		if (Array.isArray(children)) for (const child of children.slice(0, 32)) pending.push(child);
	}
	return false;
}

/** Deliberately quarantines one real private SQLite owner in an isolated
 * worker. The fault authorizer remains installed through Media.close. No
 * replacement database, fake COMMIT exception or cleanup timer is involved. */
async function run(): Promise<NativeOriginalRepairRollbackReportCurrentV1> {
	const data: unknown = workerData;
	assert.ok(data && typeof data === 'object');
	const appDataPath: unknown = Object.getOwnPropertyDescriptor(data, 'appDataPath')?.value;
	if (typeof appDataPath !== 'string') throw new TypeError('Owned worker appDataPath is required.');
	const mode: unknown = Object.getOwnPropertyDescriptor(data, 'mode')?.value;
	if (mode !== undefined && mode !== 'refused-commit' && mode !== 'lost-ack') throw new TypeError('Unknown owned rollback worker mode.');
	const lostAck = mode === 'lost-ack', originalPrimary = Symbol('exact opaque reason after genuine committed repair head');
	const databasePath = paths(appDataPath).databasePath;
	const body = new Blob(['real retained Original rollback fixture'], { type: 'application/octet-stream' });
	const sha256 = createHash('sha256').update(new Uint8Array(await body.arrayBuffer())).digest('hex');
	const binding = Object.freeze({ catalogId: 'catalog', importId: null, photoId: 'photo', assetId: 'asset', sourceId: 'source',
		sha256, size: body.size, name: 'Original.bin', mimeType: 'application/octet-stream' });
	const media = await Media.open({ appDataPath });
	let seeded = false;
	try {
		await media.writeAsset('asset', body, { name: binding.name, mimeType: binding.mimeType });
		await media.catalogOriginals.retain('catalog', [{ photoId: binding.photoId, assetId: binding.assetId, sourceId: binding.sourceId, sha256, size: body.size }]);
		seeded = true;
	} finally { if (!seeded) await media.close(); }
	const execute = DatabaseSync.prototype.exec, prepare = DatabaseSync.prototype.prepare, close = DatabaseSync.prototype.close;
	const observed: { database?: DatabaseSync; commit: number; rollback: number; privateClose: number; completed: number; readDenied: number;
		readFailure?: unknown; rollbackFailure?: unknown } = { commit: 0, rollback: 0, privateClose: 0, completed: 0, readDenied: 0 };
	let report: NativeOriginalRepairRollbackReportCurrentV1 | undefined, failed = false, primary: unknown;
	DatabaseSync.prototype.exec = function (sql: string): void {
		if (!observed.database && sql.trim() === 'COMMIT') {
			const location = Reflect.apply(prepare, this, ['PRAGMA database_list']).get();
			if (location?.file === databasePath) {
				const head = Reflect.apply(prepare, this, ['SELECT locator_id FROM native_photo_original_body_heads WHERE content_sha256=?']).get(sha256);
				// The earlier physical reservation COMMIT has no head. This is the
				// actual final Media publication, after a real fresh file exists.
				if (typeof head?.locator_id === 'string' && /^[a-f0-9]{64}$/u.test(head.locator_id)) {
					observed.database = this;
					if (lostAck) { Reflect.apply(execute, this, [sql]); observed.completed++; }
					this.setAuthorizer((action, operation) => {
						if (!lostAck && action === constants.SQLITE_TRANSACTION && operation === 'COMMIT') { observed.commit++; return constants.SQLITE_DENY; }
						if (action === constants.SQLITE_TRANSACTION && operation === 'ROLLBACK') { observed.rollback++; return constants.SQLITE_DENY; }
						if (lostAck && action === constants.SQLITE_READ && operation === 'native_photo_media_roots') { observed.readDenied++; return constants.SQLITE_DENY; }
						return constants.SQLITE_OK;
					});
					if (lostAck) throw originalPrimary;
				}
			}
		}
		try { Reflect.apply(execute, this, [sql]); }
		catch (error) { if (this === observed.database && sql.trim() === 'ROLLBACK') observed.rollbackFailure = error; throw error; }
	};
	DatabaseSync.prototype.prepare = function (sql: string) {
		try { return Reflect.apply(prepare, this, [sql]); }
		catch (error) { if (lostAck && this === observed.database && observed.readDenied > 0) observed.readFailure = error; throw error; }
	};
	DatabaseSync.prototype.close = function (): void {
		if (this === observed.database) observed.privateClose++;
		Reflect.apply(close, this, []);
	};
	try {
		const first = await media.restoreCatalogOriginalBody(binding, body).then(() => ({ rejected: false }), (error: unknown) => ({ rejected: true, error }));
		const actual = observed.database;
		assert.ok(actual, 'Fault must target the real final head publication database.');
		if (lostAck) {
			assert.equal(observed.completed, 1, 'The lost ACK must follow actual durable head COMMIT.');
			assert.ok(observed.readDenied > 0, 'Actual SQLite authorizer must deny the reconciliation root SELECT.');
		} else assert.ok(observed.commit > 0, 'Actual SQLite authorizer must deny COMMIT.');
		assert.ok(observed.rollback > 0, 'Actual SQLite authorizer must deny ROLLBACK.');
		const transactionRetained = actual.isTransaction;
		assert.equal(transactionRetained, true, 'The genuinely refused rollback must leave actual SQLite work unretired.');
		let borrowedReflections = 0;
		const reason = Symbol('Borrowed input must stay untouched after native rollback quarantine');
		const borrowed = new Proxy(binding, {
			getPrototypeOf() { borrowedReflections++; throw reason; },
			ownKeys() { borrowedReflections++; throw reason; },
			getOwnPropertyDescriptor() { borrowedReflections++; throw reason; },
		});
		const second = await media.restoreCatalogOriginalBody(borrowed, body).then(() => ({ busy: false }), (error: unknown) => ({
			busy: error instanceof Error && /busy|quarantin/iu.test(error.message),
		}));
		const closed = await media.close().then(() => ({ rejected: false }), () => ({ rejected: true }));
		report = { commitDenied: observed.commit > 0, rollbackDenied: observed.rollback > 0, transactionRetained,
			repairRejected: first.rejected, secondRepairBusy: second.busy, borrowedReflections,
			closeRejected: closed.rejected, actualPrivateCloseAttempted: observed.privateClose > 0,
			...(lostAck ? { commitCompleted: observed.completed === 1, reconciliationReadDenied: observed.readDenied > 0,
				originalPrimaryPreserved: containsAggregateLeaf('error' in first ? first.error : undefined, originalPrimary),
				readFailurePreserved: observed.readFailure !== undefined && containsAggregateLeaf('error' in first ? first.error : undefined, observed.readFailure),
				rollbackFailurePreserved: observed.rollbackFailure !== undefined && containsAggregateLeaf('error' in first ? first.error : undefined, observed.rollbackFailure) } : {}) };
	} catch (error) { failed = true; primary = error; }
	const cleanup: unknown[] = [];
	// Even a failed assertion must join Media's actual cached close. The
	// explicit native connection fallback is fixture retirement after the
	// measured close; permanent product quarantine remains until worker exit.
	try { await media.close(); } catch { /* Expected source-owned quarantine. */ }
	DatabaseSync.prototype.exec = execute; DatabaseSync.prototype.prepare = prepare; DatabaseSync.prototype.close = close;
	try {
		const actual = observed.database;
		if (actual?.isOpen) { actual.setAuthorizer(null); Reflect.apply(close, actual, []); }
	} catch (error) { cleanup.push(error); }
	if (cleanup.length) throw new AggregateError([...(failed ? [primary] : []), ...cleanup], 'Rollback worker native database retirement failed.');
	if (failed) throw primary;
	assert.ok(report); return report;
}

if (!isMainThread) {
	const port = parentPort;
	assert.ok(port);
	void run().then(report => { port.postMessage(report); }, (error: unknown) => {
		port.postMessage({ failure: error instanceof Error ? (error.stack ?? error.message).slice(0, 4096) : 'Unexpected opaque worker failure' });
		process.exitCode = 1;
	});
}
