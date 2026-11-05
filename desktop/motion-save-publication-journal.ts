/* SPDX-License-Identifier: AGPL-3.0-only */
import { createHash } from 'node:crypto';
import { constants, type BigIntStats } from 'node:fs';
import { lstat, open, link, rm, type FileHandle } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { nativeChildFileIdentityFromStat } from './native-child-file-identity.ts';
import { motionSaveFingerprint, sameMotionSaveFile, type MotionSaveDirectoryIdentity, type MotionSaveFingerprint } from './motion-save-file-identity.ts';
import { replaceMotionSaveFile, type MotionSaveFileReplacement } from './motion-save-file-replacement.ts';
import { decodeMotionSaveJournal, encodeMotionSaveJournal, type MotionSaveJournal, type MotionReadSaveJournal } from './motion-save-publication-codec.ts';

export { motionSaveFingerprint, sameMotionSaveFile } from './motion-save-file-identity.ts';
export type { MotionSaveDirectoryIdentity, MotionSaveFingerprint } from './motion-save-file-identity.ts';
export type { MotionSaveJournal, MotionReadSaveJournal } from './motion-save-publication-codec.ts';
const MAXIMUM_JOURNAL_BYTES = 8192;
const MAXIMUM_ARCHIVE_BYTES = 64 * 1024 ** 3;
export const motionSaveJournalPath = (path: string): string => join(dirname(path), `.${basename(path)}.motionscaper-save.json`);
export const motionSaveBackupPath = (path: string, id: string): string => join(dirname(path), `.${basename(path)}.motionscaper-${transaction(id)}.backup`);
export const motionSaveTemporaryPath = (path: string, id: string): string => join(dirname(path), `.${basename(path)}.motionscaper-${transaction(id)}.tmp`);
export async function captureMotionSaveDirectory(path: string): Promise<MotionSaveDirectoryIdentity> {
	const stat = await lstat(dirname(path), { bigint: true });
	if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Motion Save requires its selected regular directory.');
	return nativeChildFileIdentityFromStat(stat);
}
export async function assertMotionSaveDirectory(path: string, expected: MotionSaveDirectoryIdentity): Promise<void> {
	const actual = await captureMotionSaveDirectory(path);
	if (actual.dev !== expected.dev || actual.ino !== expected.ino) throw new Error('The selected Motion Save directory changed.');
}
export async function optionalMotionSaveFile(path: string): Promise<MotionSaveFingerprint | null> {
	try {
		const stat = await lstat(path, { bigint: true });
		if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 0n || stat.size > BigInt(MAXIMUM_ARCHIVE_BYTES)) throw new Error('Motion Save requires a bounded regular file.');
		return motionSaveFingerprint(stat);
	} catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
}
export async function syncMotionSaveDirectory(path: string, expected?: MotionSaveDirectoryIdentity): Promise<void> {
	if (expected) await assertMotionSaveDirectory(path, expected);
	if (process.platform === 'win32') return;
	const directory = await open(dirname(path), 'r'); try { await directory.sync(); } finally { await directory.close(); }
}
export async function hashMotionSaveFile(file: FileHandle, expected: MotionSaveFingerprint): Promise<string> {
	if (!sameMotionSaveFile(expected, motionSaveFingerprint(await file.stat({ bigint: true })))) throw new Error('Motion Save file identity changed before hashing.');
	const digest = createHash('sha256'), bytes = new Uint8Array(4 * 1024 * 1024); let offset = 0;
	while (offset < expected.size) {
		const result = await file.read(bytes, 0, Math.min(bytes.length, expected.size - offset), offset);
		if (!result.bytesRead) throw new Error('Motion Save file ended during verification.');
		digest.update(bytes.subarray(0, result.bytesRead)); offset += result.bytesRead;
	}
	if (!sameMotionSaveFile(expected, motionSaveFingerprint(await file.stat({ bigint: true })))) throw new Error('Motion Save file identity changed during hashing.');
	return digest.digest('hex');
}
export async function hashMotionSavePath(path: string, expected: MotionSaveFingerprint): Promise<string> {
	const file = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
	try { return await hashMotionSaveFile(file, expected); } finally { await file.close(); }
}
/** Copy the already pinned original into an independent inode without altering its ctime/link count. */
export async function copyMotionSaveBackup(path: string, backup: string, expected: MotionSaveFingerprint, parent?: MotionSaveDirectoryIdentity): Promise<{ fingerprint: MotionSaveFingerprint; sha256: string }> {
	const source = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0)); let destination: FileHandle | null = null;
	try {
		const before = await source.stat({ bigint: true }), beforeFingerprint = motionSaveFingerprint(before);
		if (!sameMotionSaveFile(expected, beforeFingerprint) || beforeFingerprint.ctimeMs !== expected.ctimeMs) throw new Error('Motion Save original changed before backup.');
		if (parent) await assertMotionSaveDirectory(path, parent);
		destination = await open(backup, 'wx', 0o600);
		const bytes = new Uint8Array(4 * 1024 * 1024), digest = createHash('sha256'); let offset = 0;
		while (offset < expected.size) {
			const result = await source.read(bytes, 0, Math.min(bytes.length, expected.size - offset), offset);
			if (!result.bytesRead) throw new Error('Motion Save original ended during backup.');
			const chunk = bytes.subarray(0, result.bytesRead); digest.update(chunk); let written = 0;
			while (written < chunk.length) {
				const output = await destination.write(chunk, written, chunk.length - written, offset + written);
				if (!output.bytesWritten) throw new Error('Motion Save backup made no progress.'); written += output.bytesWritten;
			}
			offset += result.bytesRead;
		}
		const after = await source.stat({ bigint: true }), afterFingerprint = motionSaveFingerprint(after);
		if (!sameMotionSaveFile(expected, afterFingerprint) || afterFingerprint.ctimeMs !== expected.ctimeMs && after.nlink !== 0n) throw new Error('Motion Save original changed during backup.');
		await destination.sync();
		return { fingerprint: motionSaveFingerprint(await destination.stat({ bigint: true })), sha256: digest.digest('hex') };
	} finally { await destination?.close(); await source.close(); }
}
export async function readMotionSaveJournal(path: string): Promise<MotionReadSaveJournal | null> {
	const journalPath = motionSaveJournalPath(path); let file: FileHandle;
	let selected: BigIntStats;
	try {
		selected = await lstat(journalPath, { bigint: true }); if (!selected.isFile() || selected.isSymbolicLink()) throw new Error('Motion Save journal must be a regular file.');
		file = await open(journalPath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
	}
	catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
	try {
		const before = await file.stat({ bigint: true });
		if (!sameMotionSaveFile(motionSaveFingerprint(selected), motionSaveFingerprint(before))) throw new Error('Motion Save journal identity changed before read.');
		if (!before.isFile() || before.size < 1n || before.size > BigInt(MAXIMUM_JOURNAL_BYTES)) throw new Error('Motion Save journal exceeds its regular-file byte admission.');
		const bytes = new Uint8Array(Number(before.size)); let offset = 0;
		while (offset < bytes.length) { const read = await file.read(bytes, offset, bytes.length - offset, offset); if (!read.bytesRead) throw new Error('Motion Save journal is incomplete.'); offset += read.bytesRead; }
		if (!sameMotionSaveFile(motionSaveFingerprint(before), motionSaveFingerprint(await file.stat({ bigint: true })))) throw new Error('Motion Save journal changed during read.');
		const value: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
		return decodeMotionSaveJournal(value);
	} finally { await file.close(); }
}
export async function writeMotionSaveJournal(path: string, journal: MotionSaveJournal, previous?: string, parent?: MotionSaveDirectoryIdentity, replaceFile?: MotionSaveFileReplacement): Promise<void> {
	if (parent) await assertMotionSaveDirectory(path, parent);
	const journalPath = motionSaveJournalPath(path), temporary = `${journalPath}.${journal.transactionId}.tmp`;
	const bytes = new TextEncoder().encode(JSON.stringify(encodeMotionSaveJournal(journal)));
	if (bytes.length > MAXIMUM_JOURNAL_BYTES) throw new Error('Motion Save journal exceeds its byte admission.');
	const file = await open(temporary, 'wx', 0o600);
	try { await file.writeFile(bytes); await file.sync(); } finally { await file.close(); }
	try {
		if (parent) await assertMotionSaveDirectory(path, parent);
		if (previous === undefined) await link(temporary, journalPath);
		else {
			const expected = await optionalMotionSaveFile(journalPath), current = await readMotionSaveJournal(path);
			if (!expected || current?.checksum !== previous) throw new Error('Motion Save transaction ownership changed.');
			const candidate = await optionalMotionSaveFile(temporary);
			if (!candidate) throw new Error('Motion Save journal candidate is unavailable.');
			await replaceMotionSaveFile({ source: temporary, destination: journalPath, parent: parent ?? await captureMotionSaveDirectory(path), candidate, expected }, replaceFile);
		}
	} finally { if (parent) await assertMotionSaveDirectory(path, parent); await rm(temporary, { force: true }); }
}
export async function removeMotionSaveJournal(path: string, transactionId: string, parent?: MotionSaveDirectoryIdentity): Promise<void> {
	if (parent) await assertMotionSaveDirectory(path, parent);
	const current = await readMotionSaveJournal(path);
	if (!current) return;
	if (current.journal.transactionId !== transactionId) throw new Error('Motion Save transaction ownership changed before cleanup.');
	if (parent) await assertMotionSaveDirectory(path, parent);
	await rm(motionSaveJournalPath(path));
}
/** The independent receiver never admits this writer's exact pending candidate. Other inode replacements remain independent. */
export async function motionSavePublicationEligibility(path: string, file: FileHandle, fingerprint: MotionSaveFingerprint): Promise<string> {
	const before = await readMotionSaveJournal(path);
	if (!before || !sameMotionSaveFile(before.journal.candidate, fingerprint)) return 'independent';
	const actual = await hashMotionSaveFile(file, fingerprint);
	const after = await readMotionSaveJournal(path);
	if (before.checksum !== after?.checksum) throw new Error('Motion Save publication changed during discovery; retry.');
	if (actual !== before.journal.sha256) return 'independent';
	return `${before.journal.transactionId}:${before.journal.phase}`;
}
function transaction(value: unknown): string { if (typeof value !== 'string' || !/^[a-f0-9-]{36}$/u.test(value)) throw new Error('Invalid Motion Save transaction identity.'); return value; }
