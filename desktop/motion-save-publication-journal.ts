/* SPDX-License-Identifier: AGPL-3.0-only */
import { createHash } from 'node:crypto';
import { constants, type Stats } from 'node:fs';
import { lstat, open, link, rename, rm, type FileHandle } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';

export interface MotionSaveFingerprint { readonly dev: number; readonly ino: number; readonly size: number; readonly mtimeMs: number; readonly ctimeMs: number }
export interface MotionSaveDirectoryIdentity { readonly dev: number; readonly ino: number }
export interface MotionSaveJournal {
	readonly format: 'motionscaper-save-publication'; readonly version: 1; readonly transactionId: string; readonly projectId: string;
	readonly phase: 'pending' | 'published' | 'rolled-back'; readonly candidate: MotionSaveFingerprint; readonly sha256: string;
	readonly previous: MotionSaveFingerprint | null; readonly backup: MotionSaveFingerprint | null; readonly previousSha256: string | null;
}
export interface MotionReadSaveJournal { readonly journal: MotionSaveJournal; readonly checksum: string }
const MAXIMUM_JOURNAL_BYTES = 8192;
const MAXIMUM_ARCHIVE_BYTES = 64 * 1024 ** 3;
export const motionSaveJournalPath = (path: string): string => join(dirname(path), `.${basename(path)}.motionscaper-save.json`);
export const motionSaveBackupPath = (path: string, id: string): string => join(dirname(path), `.${basename(path)}.motionscaper-${transaction(id)}.backup`);
export const motionSaveTemporaryPath = (path: string, id: string): string => join(dirname(path), `.${basename(path)}.motionscaper-${transaction(id)}.tmp`);
export async function captureMotionSaveDirectory(path: string): Promise<MotionSaveDirectoryIdentity> {
	const stat = await lstat(dirname(path));
	if (!stat.isDirectory() || stat.isSymbolicLink() || !Number.isSafeInteger(stat.dev) || !Number.isSafeInteger(stat.ino)) throw new Error('Motion Save requires its selected regular directory.');
	return { dev: stat.dev, ino: stat.ino };
}
export async function assertMotionSaveDirectory(path: string, expected: MotionSaveDirectoryIdentity): Promise<void> {
	const actual = await captureMotionSaveDirectory(path);
	if (actual.dev !== expected.dev || actual.ino !== expected.ino) throw new Error('The selected Motion Save directory changed.');
}
export function motionSaveFingerprint(stat: Stats): MotionSaveFingerprint { return { dev: stat.dev, ino: stat.ino, size: stat.size, mtimeMs: stat.mtimeMs, ctimeMs: stat.ctimeMs }; }
export function sameMotionSaveFile(a: MotionSaveFingerprint | null | undefined, b: MotionSaveFingerprint | null | undefined): boolean {
	return !!a && !!b && a.dev === b.dev && a.ino === b.ino && a.size === b.size && a.mtimeMs === b.mtimeMs;
}
export async function optionalMotionSaveFile(path: string): Promise<MotionSaveFingerprint | null> {
	try {
		const stat = await lstat(path);
		if (!stat.isFile() || stat.isSymbolicLink() || !Number.isSafeInteger(stat.size) || stat.size < 0 || stat.size > MAXIMUM_ARCHIVE_BYTES) throw new Error('Motion Save requires a bounded regular file.');
		return motionSaveFingerprint(stat);
	} catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
}
export async function syncMotionSaveDirectory(path: string, expected?: MotionSaveDirectoryIdentity): Promise<void> {
	if (expected) await assertMotionSaveDirectory(path, expected);
	if (process.platform === 'win32') return;
	const directory = await open(dirname(path), 'r'); try { await directory.sync(); } finally { await directory.close(); }
}
export async function hashMotionSaveFile(file: FileHandle, expected: MotionSaveFingerprint): Promise<string> {
	if (!sameMotionSaveFile(expected, motionSaveFingerprint(await file.stat()))) throw new Error('Motion Save file identity changed before hashing.');
	const digest = createHash('sha256'), bytes = new Uint8Array(4 * 1024 * 1024); let offset = 0;
	while (offset < expected.size) {
		const result = await file.read(bytes, 0, Math.min(bytes.length, expected.size - offset), offset);
		if (!result.bytesRead) throw new Error('Motion Save file ended during verification.');
		digest.update(bytes.subarray(0, result.bytesRead)); offset += result.bytesRead;
	}
	if (!sameMotionSaveFile(expected, motionSaveFingerprint(await file.stat()))) throw new Error('Motion Save file identity changed during hashing.');
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
		const before = await source.stat();
		if (!sameMotionSaveFile(expected, motionSaveFingerprint(before)) || before.ctimeMs !== expected.ctimeMs) throw new Error('Motion Save original changed before backup.');
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
		const after = await source.stat();
		if (!sameMotionSaveFile(expected, motionSaveFingerprint(after)) || after.ctimeMs !== expected.ctimeMs && after.nlink !== 0) throw new Error('Motion Save original changed during backup.');
		await destination.sync();
		return { fingerprint: motionSaveFingerprint(await destination.stat()), sha256: digest.digest('hex') };
	} finally { await destination?.close(); await source.close(); }
}
export async function readMotionSaveJournal(path: string): Promise<MotionReadSaveJournal | null> {
	const journalPath = motionSaveJournalPath(path); let file: FileHandle;
	let selected: Stats;
	try {
		selected = await lstat(journalPath); if (!selected.isFile() || selected.isSymbolicLink()) throw new Error('Motion Save journal must be a regular file.');
		file = await open(journalPath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
	}
	catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
	try {
		const before = await file.stat();
		if (!sameMotionSaveFile(motionSaveFingerprint(selected), motionSaveFingerprint(before))) throw new Error('Motion Save journal identity changed before read.');
		if (!before.isFile() || before.size < 1 || before.size > MAXIMUM_JOURNAL_BYTES) throw new Error('Motion Save journal exceeds its regular-file byte admission.');
		const bytes = new Uint8Array(before.size); let offset = 0;
		while (offset < bytes.length) { const read = await file.read(bytes, offset, bytes.length - offset, offset); if (!read.bytesRead) throw new Error('Motion Save journal is incomplete.'); offset += read.bytesRead; }
		if (!sameMotionSaveFile(motionSaveFingerprint(before), motionSaveFingerprint(await file.stat()))) throw new Error('Motion Save journal changed during read.');
		const value: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
		const envelope = record(value, ['journal', 'checksum']);
		const journal = normalizeJournal(envelope.journal), checksum = digest(envelope.checksum);
		if (checksum !== seal(journal)) throw new Error('Motion Save journal checksum does not match.');
		return { journal, checksum };
	} finally { await file.close(); }
}
export async function writeMotionSaveJournal(path: string, journal: MotionSaveJournal, previous?: string, parent?: MotionSaveDirectoryIdentity): Promise<void> {
	if (parent) await assertMotionSaveDirectory(path, parent);
	const journalPath = motionSaveJournalPath(path), temporary = `${journalPath}.${journal.transactionId}.tmp`;
	const bytes = new TextEncoder().encode(JSON.stringify({ journal, checksum: seal(journal) }));
	if (bytes.length > MAXIMUM_JOURNAL_BYTES) throw new Error('Motion Save journal exceeds its byte admission.');
	const file = await open(temporary, 'wx', 0o600);
	try { await file.writeFile(bytes); await file.sync(); } finally { await file.close(); }
	try {
		if (parent) await assertMotionSaveDirectory(path, parent);
		if (previous === undefined) await link(temporary, journalPath);
		else { const current = await readMotionSaveJournal(path); if (current?.checksum !== previous) throw new Error('Motion Save transaction ownership changed.'); await rename(temporary, journalPath); }
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
function seal(value: MotionSaveJournal): string { return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
function transaction(value: unknown): string { if (typeof value !== 'string' || !/^[a-f0-9-]{36}$/u.test(value)) throw new Error('Invalid Motion Save transaction identity.'); return value; }
function digest(value: unknown): string { if (typeof value !== 'string' || !/^[a-f0-9]{64}$/u.test(value)) throw new Error('Invalid Motion Save digest.'); return value; }
function record(value: unknown, fields: readonly string[]): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== fields.length || fields.some(field => !Object.hasOwn(value, field))) throw new Error('Motion Save journal has unsupported fields.');
	return value as Record<string, unknown>;
}
function fingerprint(value: unknown): MotionSaveFingerprint {
	const fields = ['dev', 'ino', 'size', 'mtimeMs', 'ctimeMs'] as const, input = record(value, fields);
	for (const field of fields) if (typeof input[field] !== 'number' || !Number.isFinite(input[field]) || Number(input[field]) < 0) throw new Error('Motion Save journal has an invalid fingerprint.');
	if (!Number.isSafeInteger(input.dev) || !Number.isSafeInteger(input.ino) || !Number.isSafeInteger(input.size) || Number(input.size) > MAXIMUM_ARCHIVE_BYTES) throw new Error('Motion Save journal fingerprint exceeds its admission.');
	return { dev: Number(input.dev), ino: Number(input.ino), size: Number(input.size), mtimeMs: Number(input.mtimeMs), ctimeMs: Number(input.ctimeMs) };
}
function normalizeJournal(value: unknown): MotionSaveJournal {
	const input = record(value, ['format', 'version', 'transactionId', 'projectId', 'phase', 'candidate', 'sha256', 'previous', 'backup', 'previousSha256']);
	if (input.format !== 'motionscaper-save-publication' || input.version !== 1 || (input.phase !== 'pending' && input.phase !== 'published' && input.phase !== 'rolled-back') || typeof input.projectId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(input.projectId)) throw new Error('Unsupported Motion Save journal.');
	if ((input.previous === null) !== (input.previousSha256 === null) || (input.previous === null) !== (input.backup === null)) throw new Error('Motion Save prior backup metadata is incomplete.');
	return { format: 'motionscaper-save-publication', version: 1, transactionId: transaction(input.transactionId), projectId: input.projectId, phase: input.phase,
		candidate: fingerprint(input.candidate), sha256: digest(input.sha256), previous: input.previous === null ? null : fingerprint(input.previous), backup: input.backup === null ? null : fingerprint(input.backup), previousSha256: input.previousSha256 === null ? null : digest(input.previousSha256) };
}
