/* SPDX-License-Identifier: AGPL-3.0-only */

import { beginMotionscaperDesktopSave, motionscaperDesktopFiles, selectMotionscaperDesktopArchive, type MotionDesktopArchiveInput } from './desktop-file-adapter.ts';
import type { MotionDesktopFiles } from './desktop-file-contract.ts';
import type { MotionscaperDocumentSession } from './editor-document-session.ts';
import type { MotionscaperProjectStore } from './editor-project-store.ts';
import type { MotionscaperProject } from './editor-project-types.ts';
import { motionDocumentFileName } from './editor-document-file-name.ts';
import { aggregateScapeErrors } from '../common/scape/abort.ts';
import { MotionProjectConflictError } from './editor-project-store.ts';
import { prepareMotionscaperDocumentOpen, type MotionscaperDocumentOpen } from './editor-document-open.ts';
import { exportMotionscaperArchive } from './editor-scape.ts';
import { assertNativeSaveReceipt, MotionNativeSaveCleanupError, type MotionNativeSaveDriver, type MotionNativeSaveRecoveryDriver } from './editor-native-save.ts';
import { inspectMotionscaperOpaqueArchive, type MotionscaperOpaqueArchive } from './editor-opaque-archive.ts';

/** Normal Save returns a fenced candidate; only the owning document session may publish it. */
export async function writeMotionscaperDesktopProject(project: MotionscaperProject, store: Pick<MotionscaperProjectStore, 'readAsset'>,
	files: MotionDesktopFiles | null = motionscaperDesktopFiles(), saveCopy = false, assertCurrent?: () => Promise<void>): Promise<boolean | MotionNativeSaveDriver | MotionNativeSaveRecoveryDriver> {
	if (!files) return true;
	await assertCurrent?.();
	const output = await beginMotionscaperDesktopSave(files, { projectId: project.id, suggestedName: motionDocumentFileName(project.title),
		...(saveCopy ? { saveAs: true, saveCopy: true } : {}) });
	if (!output) return false;
	if (output.recoveredPublication) {
		return Object.freeze({ kind: 'motion-native-save-recovery' as const, receipt: output.recoveredPublication,
			abort: () => output.abort(), acknowledge: () => output.acknowledge() });
	}
	try {
		await exportMotionscaperArchive(project, (asset) => store.readAsset(asset), { writable: output.writable });
		await assertCurrent?.();
		if (saveCopy) { await output.commit(); return true; }
		const receipt = await output.prepare(); assertNativeSaveReceipt(receipt, 'prepared');
		return Object.freeze({ kind: 'motion-native-save' as const, receipt,
			async publish() { await assertCurrent?.(); return output.commit(); }, status: () => output.status(),
			abort: () => output.abort(), acknowledge: () => output.acknowledge() });
	} catch (error) {
		const cleanup = async () => { await output.abort(); await output.acknowledge(); };
		try { await cleanup(); } catch (failure) { throw new MotionNativeSaveCleanupError(aggregateScapeErrors(error, [failure], 'Motion archive save and cleanup failed.'), cleanup); }
		throw error;
	}
}

/** The open capability remains private and is bound only after a complete verified archive import. */
export async function openMotionscaperDesktopProject(session: MotionscaperDocumentSession,
	files: MotionDesktopFiles | null = motionscaperDesktopFiles(),
	onOpaque?: (archive: MotionscaperOpaqueArchive) => void | Promise<void>,
	onReview?: (pending: MotionscaperDocumentOpen) => void | Promise<void>,
	onAdobeProject?: (name: string) => void): Promise<'browser' | 'cancelled' | 'opened' | 'opaque' | 'review' | 'after-effects'> {
	if (!files) return 'browser';
	const selected = await selectMotionscaperDesktopArchive(files);
	if (!selected) return 'cancelled';
	return openMotionscaperDesktopArchiveSelection(session, selected, onOpaque, onReview, onAdobeProject);
}

export async function openMotionscaperDesktopArchiveSelection(session: MotionscaperDocumentSession, selected: MotionDesktopArchiveInput,
	onOpaque?: (archive: MotionscaperOpaqueArchive) => void | Promise<void>,
	onReview?: (pending: MotionscaperDocumentOpen) => void | Promise<void>,
	onAdobeProject?: (name: string) => void): Promise<'opened' | 'opaque' | 'review' | 'after-effects'> {
	let retained = false, failed = false; let failure: unknown; let result: 'opened' | 'opaque' | 'review' | 'after-effects' | undefined;
	const inspect = async (): Promise<'opened' | 'opaque' | 'review' | 'after-effects'> => {
		if (/\.aepx?$/iu.test(selected.name)) {
			if (!onAdobeProject) throw new Error('Open this Adobe project through the After Effects Bridge.');
			onAdobeProject(selected.name); return 'after-effects';
		}
		if (selected.recoveredPublication) {
			if (!selected.markRecoveryReconciled) throw new Error('Native recovery requires an authenticated acknowledgement capability.');
			await session.reconcileNativeSave(selected.recoveredPublication); selected.markRecoveryReconciled();
		}
		if (onOpaque) {
			const archive = await inspectMotionscaperOpaqueArchive(selected.input, selected.name, { release: selected.release });
			if (archive) { await onOpaque(archive); retained = true; return 'opaque'; }
		}
		const pending = await prepareMotionscaperDocumentOpen(session, selected.input, selected.name, { bindOriginal: selected.bind, release: selected.release });
		if (onReview) { retained = true; await onReview(pending); return 'review'; }
		if (pending.review.existing) { await pending.close(); throw new MotionProjectConflictError(); }
		await pending.open('import'); return 'opened';
	};
	try { result = await inspect(); } catch (error) { failed = true; failure = error; }
	if (!retained) {
		try { await selected.release(); } catch (cleanup) { throw failed ? aggregateScapeErrors(failure, [cleanup], 'Motion archive open and capability release failed.') : cleanup; }
	}
	if (failed) throw failure; return result!;
}
