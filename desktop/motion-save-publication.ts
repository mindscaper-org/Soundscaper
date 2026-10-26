/* SPDX-License-Identifier: AGPL-3.0-only */
import { rename, rm, type FileHandle } from 'node:fs/promises';
import { basename } from 'node:path';
import type { MotionRecoveredPublication, MotionSaveFileReceipt } from '../src/motionscaper/desktop-file-contract.ts';
import { assertMotionSaveDirectory, captureMotionSaveDirectory, copyMotionSaveBackup, hashMotionSavePath, motionSaveBackupPath, motionSaveTemporaryPath, optionalMotionSaveFile, readMotionSaveJournal, removeMotionSaveJournal,
	sameMotionSaveFile, syncMotionSaveDirectory, writeMotionSaveJournal, type MotionSaveDirectoryIdentity, type MotionSaveFingerprint, type MotionSaveJournal, type MotionReadSaveJournal } from './motion-save-publication-journal.ts';

export type MotionSavePublicationCheckpoint = 'candidate-directory-sync' | 'candidate-fingerprint' | 'before-publication' | 'rollback-directory-sync' | 'published-cleanup';
export interface MotionSavePublicationOptions { readonly checkpoint?: (phase: MotionSavePublicationCheckpoint) => Promise<void> }
export interface MotionSavePublication {
	prepare(): Promise<MotionSaveFileReceipt>; publish(): Promise<MotionSaveFileReceipt>; status(): Promise<MotionSaveFileReceipt>;
	abort(acknowledge?: boolean): Promise<MotionSaveFingerprint | null | undefined>;
}
interface Input extends MotionSavePublicationOptions {
	readonly path: string; readonly temporary: string; readonly file: FileHandle; readonly expected: MotionSaveFingerprint | null;
	readonly parent: MotionSaveDirectoryIdentity;
	readonly projectId: string; readonly transactionId: string; readonly byteLength: number; readonly sha256: string;
	close(): Promise<void>;
}
/** The journal is the cross-process publication authority; a complete candidate alone is never a saved revision. */
export function createMotionSavePublication(input: Input): MotionSavePublication {
	let journal: MotionSaveJournal | null = null, prepared = false, published: MotionSaveFileReceipt | null = null;
	let stopped = false;
	const receipt = (publication: 'prepared' | 'published' | 'rolled-back', cleanupError?: string): MotionSaveFileReceipt => Object.freeze({
		name: basename(input.path), byteLength: input.byteLength, sha256: input.sha256, publication, transactionId: input.transactionId,
		...(cleanupError === undefined ? {} : { cleanupError }),
	});
	async function owned(): Promise<MotionReadSaveJournal> {
		await assertMotionSaveDirectory(input.path, input.parent);
		const current = await readMotionSaveJournal(input.path);
		if (!current || current.journal.transactionId !== input.transactionId) throw new Error('Motion Save transaction ownership changed.');
		return current;
	}
	async function prepare(): Promise<MotionSaveFileReceipt> {
		if (published) return published;
		if (stopped) throw new Error('Motion Save transaction was cancelled.');
		await assertMotionSaveDirectory(input.path, input.parent);
		if (prepared) return receipt('prepared');
		if (!journal) {
			assertExpected(input.expected, await optionalMotionSaveFile(input.path));
			await input.file.sync();
			const candidate = await optionalMotionSaveFile(input.temporary); if (!candidate || candidate.size !== input.byteLength) throw new Error('Motion Save candidate is incomplete.');
			let previousSha256: string | null = null, backupFingerprint: MotionSaveFingerprint | null = null;
			if (input.expected) {
				const backup = motionSaveBackupPath(input.path, input.transactionId);
				const copy = await copyMotionSaveBackup(input.path, backup, input.expected, input.parent);
				if (await hashMotionSavePath(backup, copy.fingerprint) !== copy.sha256) throw new Error('Motion Save prior backup verification failed.');
				previousSha256 = copy.sha256; backupFingerprint = copy.fingerprint;
			}
			assertExpected(input.expected, await optionalMotionSaveFile(input.path));
			journal = { format: 'motionscaper-save-publication', version: 1, transactionId: input.transactionId, projectId: input.projectId,
				phase: 'pending', candidate, sha256: input.sha256, previous: input.expected, backup: backupFingerprint, previousSha256 };
			await writeMotionSaveJournal(input.path, journal, undefined, input.parent); await syncMotionSaveDirectory(input.path, input.parent);
			await input.close();
			await assertMotionSaveDirectory(input.path, input.parent);
			assertExpected(input.expected, await optionalMotionSaveFile(input.path));
			await rename(input.temporary, input.path);
		}
		await owned();
		await input.checkpoint?.('candidate-directory-sync'); await syncMotionSaveDirectory(input.path, input.parent);
		await input.checkpoint?.('candidate-fingerprint');
		await assertMotionSaveDirectory(input.path, input.parent);
		const candidate = await optionalMotionSaveFile(input.path);
		if (!sameMotionSaveFile(journal.candidate, candidate) || !candidate || await hashMotionSavePath(input.path, candidate) !== input.sha256) throw new Error('Motion Save candidate changed before preparation completed.');
		prepared = true; return receipt('prepared');
	}
	async function cleanupPublished(): Promise<void> {
		await input.checkpoint?.('published-cleanup');
		await assertMotionSaveDirectory(input.path, input.parent);
		await rm(motionSaveBackupPath(input.path, input.transactionId), { force: true });
		await rm(input.temporary, { force: true });
		await syncMotionSaveDirectory(input.path, input.parent);
	}
	async function publish(): Promise<MotionSaveFileReceipt> {
		if (published) return published;
		if (!prepared || stopped) throw new Error('Prepare the complete Motion Save before publication.');
		const current = await owned();
		if (current.journal.phase !== 'published') {
			const candidate = await optionalMotionSaveFile(input.path);
			if (!candidate || !sameMotionSaveFile(current.journal.candidate, candidate) || await hashMotionSavePath(input.path, candidate) !== input.sha256) throw new Error('Motion Save candidate changed before publication.');
			await input.checkpoint?.('before-publication');
			await assertMotionSaveDirectory(input.path, input.parent);
			if (!sameMotionSaveFile(candidate, await optionalMotionSaveFile(input.path))) throw new Error('Motion Save candidate changed before publication.');
			// This atomic state transition is the only publication point. Later failures cannot revoke it.
			try { await writeMotionSaveJournal(input.path, { ...current.journal, phase: 'published' }, current.checksum, input.parent); }
			catch (error) {
				const observed = await owned(); if (observed.journal.phase !== 'published') throw error;
				published = receipt('published', message(error)); return published;
			}
		}
		published = receipt('published');
		try { await cleanupPublished(); } catch (error) { published = receipt('published', message(error)); }
		// Keep the published journal until the renderer acknowledges durable store activation.
		return published;
	}
	return Object.freeze({ prepare, publish,
		async status() {
			if (published) return published;
			const current = await owned();
			if (current.journal.phase === 'published') { published = receipt('published'); return published; }
			if (current.journal.phase === 'rolled-back') return receipt('rolled-back');
			if (!prepared) throw new Error('Motion Save preparation is incomplete; retry or cancel it.');
			return receipt('prepared');
		},
		async abort(acknowledge = false) {
			await assertMotionSaveDirectory(input.path, input.parent);
			const current = await readMotionSaveJournal(input.path);
			if (current && current.journal.transactionId !== input.transactionId) throw new Error('Motion Save transaction ownership changed before cancellation.');
			if (published || current?.journal.phase === 'published') {
				published ??= receipt('published');
				if (acknowledge) { await cleanupPublished(); await removeMotionSaveJournal(input.path, input.transactionId, input.parent); published = receipt('published'); }
				return undefined;
			}
			await input.close();
			if (current?.journal.phase === 'rolled-back') {
				const restored = await optionalMotionSaveFile(input.path);
				if (acknowledge) await acknowledgeMotionSaveRecovery(input.path, input.transactionId, input.parent);
				stopped = true;
				return sameMotionSaveFile(current.journal.backup, restored) || sameMotionSaveFile(current.journal.previous, restored) || current.journal.previous === null && restored === null ? restored : undefined;
			}
			if (acknowledge && current) throw new Error('Roll back the pending Motion Save before acknowledging it.');
			prepared = false;
			const restored = current ? await rollbackMotionSavePublication(input.path, current, input.parent, input.checkpoint, true) : undefined;
			await assertMotionSaveDirectory(input.path, input.parent);
			await rm(input.temporary, { force: true }); await rm(motionSaveBackupPath(input.path, input.transactionId), { force: true });
			stopped = true; return restored;
		},
	});
}
/** Selected native path grant only. Restart never promotes a merely complete pending candidate. */
export async function recoverMotionSavePublication(path: string, options: MotionSavePublicationOptions = {}, selectedParent?: MotionSaveDirectoryIdentity): Promise<MotionRecoveredPublication | undefined> {
	const parent = selectedParent ?? await captureMotionSaveDirectory(path); await assertMotionSaveDirectory(path, parent);
	const current = await readMotionSaveJournal(path); if (!current) return undefined;
	const { journal } = current;
	if (journal.phase === 'pending') {
		await rollbackMotionSavePublication(path, current, parent, options.checkpoint, true);
		await assertMotionSaveDirectory(path, parent);
		await rm(motionSaveTemporaryPath(path, journal.transactionId), { force: true });
	}
	// A published file remains openable even when debris cleanup is still blocked.
	// Only an explicit settled acknowledgement may discard its retained correlation.
	return Object.freeze({ transactionId: journal.transactionId, publication: journal.phase === 'published' ? 'published' : 'rolled-back', byteLength: journal.candidate.size, sha256: journal.sha256 });
}
export async function acknowledgeMotionSaveRecovery(path: string, transactionId: string, parent?: MotionSaveDirectoryIdentity, options: MotionSavePublicationOptions = {}): Promise<void> {
	const selectedParent = parent ?? await captureMotionSaveDirectory(path); await assertMotionSaveDirectory(path, selectedParent);
	const current = await readMotionSaveJournal(path);
	if (!current) return;
	if (current.journal.transactionId !== transactionId || current.journal.phase === 'pending') throw new Error('Motion Save recovery cannot acknowledge another pending transaction.');
	if (current.journal.phase === 'published') await options.checkpoint?.('published-cleanup');
	await assertMotionSaveDirectory(path, selectedParent);
	await rm(motionSaveBackupPath(path, transactionId), { force: true });
	await rm(motionSaveTemporaryPath(path, transactionId), { force: true });
	await syncMotionSaveDirectory(path, selectedParent);
	await removeMotionSaveJournal(path, transactionId, selectedParent); await syncMotionSaveDirectory(path, selectedParent);
}
async function rollbackMotionSavePublication(path: string, captured: MotionReadSaveJournal, parent: MotionSaveDirectoryIdentity, checkpoint?: MotionSavePublicationOptions['checkpoint'], retainRecovery = false): Promise<MotionSaveFingerprint | null | undefined> {
	await assertMotionSaveDirectory(path, parent);
	const current = await readMotionSaveJournal(path);
	if (!current || current.checksum !== captured.checksum || current.journal.phase !== 'pending') throw new Error('Motion Save transaction changed before rollback.');
	const journal = current.journal, candidate = await optionalMotionSaveFile(path), backup = motionSaveBackupPath(path, journal.transactionId);
	let restored: MotionSaveFingerprint | null | undefined;
	if (sameMotionSaveFile(journal.candidate, candidate)) {
		if (!candidate || await hashMotionSavePath(path, candidate) !== journal.sha256) throw new Error('Motion Save candidate changed before rollback.');
		if (journal.previous) {
			const prior = await optionalMotionSaveFile(backup);
			if (!prior || await hashMotionSavePath(backup, prior) !== journal.previousSha256) throw new Error('Motion Save prior backup is unavailable or corrupt.');
			if (!sameMotionSaveFile(candidate, await optionalMotionSaveFile(path))) throw new Error('Motion Save destination changed before rollback.');
			await assertMotionSaveDirectory(path, parent);
			await rename(backup, path);
		} else { await assertMotionSaveDirectory(path, parent); await rm(path); }
		await checkpoint?.('rollback-directory-sync'); await syncMotionSaveDirectory(path, parent);
		restored = await optionalMotionSaveFile(path);
		if (journal.previous && (!restored || await hashMotionSavePath(path, restored) !== journal.previousSha256)) throw new Error('Motion Save rollback verification failed.');
	} else if (sameMotionSaveFile(journal.backup, candidate)) {
		if (!candidate || await hashMotionSavePath(path, candidate) !== journal.previousSha256) throw new Error('Motion Save restored backup changed before retry.');
		await checkpoint?.('rollback-directory-sync'); await syncMotionSaveDirectory(path, parent); restored = candidate;
	} else if (sameMotionSaveFile(journal.previous, candidate) || journal.previous === null && candidate === null) restored = candidate;
	// A different external inode owns the path. Its bytes must never be overwritten.
	await assertMotionSaveDirectory(path, parent);
	await rm(backup, { force: true });
	if (retainRecovery) await writeMotionSaveJournal(path, { ...journal, phase: 'rolled-back' }, current.checksum, parent);
	else await removeMotionSaveJournal(path, journal.transactionId, parent);
	await syncMotionSaveDirectory(path, parent);
	return restored;
}
function assertExpected(expected: MotionSaveFingerprint | null, actual: MotionSaveFingerprint | null): void {
	if (JSON.stringify(expected) !== JSON.stringify(actual)) throw new Error('The selected Motionscaper archive changed outside this save.');
}
function message(error: unknown): string { return (error instanceof Error ? error.message : String(error)).slice(0, 4096); }
