/* SPDX-License-Identifier: AGPL-3.0-only */
import type { MotionscaperProject } from './editor-project-types.ts';
import type { MotionscaperProjectStore } from './editor-project-store.ts';
import type { MotionscaperRevision } from './editor-project-revision.ts';
import type { MotionProjectWriteLease } from './editor-project-write-lease.ts';
import type { MotionSaveFileReceipt, MotionRecoveredPublication } from './desktop-file-contract.ts';
import { assertNativeSaveReceipt, MotionNativeSaveCleanupError, MotionNativeSaveReconciliationError,
	type MotionNativeSaveDriver, type MotionPreparedNativeSave } from './editor-native-save.ts';

interface Pending {
	readonly driver: MotionNativeSaveDriver; record: MotionPreparedNativeSave | null;
	receipt: MotionSaveFileReceipt; rollback: boolean;
}
/** Native file publication and local saved-head reconciliation have one retained owner. */
export class MotionNativeSaveSession {
	readonly #store: MotionscaperProjectStore;
	#pending: Pending | null = null;
	#cleanup: (() => Promise<void>) | null = null;
	constructor(store: MotionscaperProjectStore) { this.#store = store; }
	get pending(): boolean { return this.#pending !== null || this.#cleanup !== null; }
	rememberCleanup(error: unknown): void { if (error instanceof MotionNativeSaveCleanupError) this.#cleanup = error.retryCleanup; }
	async start(project: MotionscaperProject, expectedDigest: string | null, lease: MotionProjectWriteLease,
		driver: MotionNativeSaveDriver): Promise<MotionscaperRevision> {
		if (this.pending) throw new Error('Resolve the preceding native Save first.');
		assertNativeSaveReceipt(driver.receipt, 'prepared');
		const pending: Pending = { driver, record: null, receipt: driver.receipt, rollback: false }; this.#pending = pending;
		try {
			pending.record = await this.#store.prepareNativeSave(project, expectedDigest, lease, driver.receipt);
			try { pending.receipt = await driver.publish(); }
			catch (error) {
				pending.receipt = await driver.status();
				if (pending.receipt.publication !== 'published') throw error;
			}
			return await this.#finish(pending, lease);
		} catch (error) {
			let status: MotionSaveFileReceipt;
			try { status = await driver.status(); pending.receipt = status; }
			catch (unknown) { throw new MotionNativeSaveReconciliationError(false, new AggregateError([error, unknown], 'Native Save outcome is not yet known.')); }
			if (status.publication === 'published') throw new MotionNativeSaveReconciliationError(true, error);
			pending.rollback = true;
			try { await this.#rollback(pending, lease); }
			catch (cleanup) { throw new MotionNativeSaveReconciliationError(false, new AggregateError([error, cleanup], 'Native Save failed and rollback needs retry.')); }
			throw error;
		}
	}
	async #finish(pending: Pending, lease: MotionProjectWriteLease): Promise<MotionscaperRevision> {
		if (!pending.record) throw new Error('Published native Save has no durable local preparation.');
		assertNativeSaveReceipt(pending.receipt, 'published', pending.record);
		const saved = await this.#store.finalizeNativeSave(pending.record, pending.receipt, lease);
		await pending.driver.acknowledge(); this.#pending = null; return saved;
	}
	async #rollback(pending: Pending, lease: MotionProjectWriteLease): Promise<void> {
		await pending.driver.abort();
		const receipt = await pending.driver.status(); assertNativeSaveReceipt(receipt, 'rolled-back', pending.record ?? undefined);
		if (receipt.transactionId !== pending.driver.receipt.transactionId || receipt.sha256 !== pending.driver.receipt.sha256
			|| receipt.byteLength !== pending.driver.receipt.byteLength) throw new Error('Native rollback receipt changed identity.');
		if (pending.record) await this.#store.cancelNativeSave(pending.record, receipt, lease);
		await pending.driver.acknowledge(); this.#pending = null;
	}
	async retry(lease: MotionProjectWriteLease): Promise<MotionscaperRevision | null> {
		try {
			if (this.#cleanup) { await this.#cleanup(); this.#cleanup = null; return null; }
			const pending = this.#pending; if (!pending) return null;
			pending.receipt = await pending.driver.status();
			if (pending.receipt.publication === 'published') return await this.#finish(pending, lease);
			await this.#rollback(pending, lease); return null;
		} catch (error) { throw new MotionNativeSaveReconciliationError(this.#pending?.receipt.publication === 'published', error); }
	}

	async recovery(receipt: MotionRecoveredPublication): Promise<MotionPreparedNativeSave | null> {
		assertNativeSaveReceipt(receipt, receipt.publication);
		if (this.#pending && this.#pending.driver.receipt.transactionId !== receipt.transactionId) throw new Error('Resolve the active native Save before opening another recovered transaction.');
		return await this.#store.loadNativeSaveTransaction(receipt.transactionId) ?? this.#pending?.record ?? null;
	}
	async reconcile(record: MotionPreparedNativeSave | null, receipt: MotionRecoveredPublication, lease?: MotionProjectWriteLease): Promise<MotionscaperRevision | null> {
		assertNativeSaveReceipt(receipt, receipt.publication, record ?? undefined);
		if (this.#cleanup) { await this.#cleanup(); this.#cleanup = null; }
		if (!record) {
			// An already reconciled Save or an independent saved copy has no local reservation.
			this.#pending = null; return null;
		}
		if (!lease || lease.projectId !== record.projectId) throw new Error('Native recovery requires its transaction owner write access.');
		if (receipt.publication === 'published') {
			const saved = await this.#store.finalizeNativeSave(record, receipt, lease, true); this.#pending = null; return saved;
		}
		await this.#store.cancelNativeSave(record, receipt, lease, true); this.#pending = null; return null;
	}

	async close(lease: MotionProjectWriteLease): Promise<void> { if (this.pending) await this.retry(lease); }
}
