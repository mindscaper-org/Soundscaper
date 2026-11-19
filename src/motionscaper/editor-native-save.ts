/* SPDX-License-Identifier: AGPL-3.0-only */
import type { MotionSaveFileReceipt, MotionRecoveredPublication } from './desktop-file-contract.ts';
import { motionDigest, motionId, motionInteger, motionRecord } from '../common/editor/motion-values.ts';
import { verifyMotionscaperRevision, type MotionscaperRevision } from './editor-project-revision.ts';

export const MOTION_NATIVE_SAVE_STORE = 'nativeSaves';
export interface MotionNativeSaveDriver {
	readonly kind: 'motion-native-save';
	readonly receipt: MotionSaveFileReceipt;
	publish(): Promise<MotionSaveFileReceipt>;
	status(): Promise<MotionSaveFileReceipt>;
	abort(): Promise<void>;
	acknowledge(): Promise<void>;
}
export interface MotionNativeSaveRecoveryDriver {
	readonly kind: 'motion-native-save-recovery'; readonly receipt: MotionRecoveredPublication;
	abort(): Promise<void>; acknowledge(): Promise<void>;
}
export interface MotionPreparedNativeSave {
	readonly id: string; readonly projectId: string; readonly expectedDigest: string | null;
	readonly snapshot: MotionscaperRevision; readonly leaseToken: string;
	readonly archiveSha256: string; readonly archiveByteLength: number;
}
export class MotionNativeSaveReconciliationError extends Error {
	readonly published: boolean;
	constructor(published: boolean, cause: unknown) {
		super(published ? 'The native file was published. Retry Save to finish local reconciliation.'
			: 'The native Save is unresolved. Retry Save or reopen its selected file before editing.', { cause });
		this.name = 'MotionNativeSaveReconciliationError'; this.published = published;
	}
}
export function assertNativeSaveReceipt(receipt: MotionSaveFileReceipt | MotionRecoveredPublication,
	phase: 'prepared' | 'published' | 'rolled-back', expected?: MotionPreparedNativeSave): void {
	if (receipt.publication !== phase || !receipt.transactionId) throw new Error(`Native Save requires an authoritative ${phase} transaction receipt.`);
	motionId(receipt.transactionId); motionDigest(receipt.sha256); motionInteger(receipt.byteLength, 'native archive byte length', 1, 64 * 1024 ** 3);
	if (expected && (receipt.transactionId !== expected.id || receipt.sha256 !== expected.archiveSha256 || receipt.byteLength !== expected.archiveByteLength)) {
		throw new Error('Native Save transaction receipt does not match its prepared revision.');
	}
}
export function readPreparedNativeSave(value: unknown): MotionPreparedNativeSave {
	const row = motionRecord(value, ['id', 'projectId', 'expectedDigest', 'snapshot', 'leaseToken', 'archiveSha256', 'archiveByteLength'], 'prepared native Save');
	const snapshot = verifyMotionscaperRevision(row.snapshot), projectId = motionId(row.projectId);
	if (snapshot.projectId !== projectId) throw new Error('Prepared native Save project identity changed.');
	return Object.freeze({ id: motionId(row.id), projectId, expectedDigest: row.expectedDigest === null ? null : motionDigest(row.expectedDigest),
		snapshot, leaseToken: motionId(row.leaseToken), archiveSha256: motionDigest(row.archiveSha256),
		archiveByteLength: motionInteger(row.archiveByteLength, 'native archive byte length', 1, 64 * 1024 ** 3) });
}

/** Keeps prepublication cleanup capabilities reachable after a failed preparation. */
export class MotionNativeSaveCleanupError extends Error {
	readonly retryCleanup: () => Promise<void>;
	constructor(cause: unknown, retryCleanup: () => Promise<void>) {
		super(`Native Save cleanup needs retry: ${String(cause)}`, { cause });
		this.name = 'MotionNativeSaveCleanupError'; this.retryCleanup = retryCleanup;
	}
}
