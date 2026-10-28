/* SPDX-License-Identifier: AGPL-3.0-only */
import { randomUUID, createHash, type Hash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open, rm, type FileHandle } from 'node:fs/promises';
import { basename, extname, isAbsolute } from 'node:path';
import { MOTIONSCAPER_FILE_CHUNK_BYTES, type MotionDesktopFiles, type MotionOpenFileCapability, type MotionRecoveredPublication, type MotionSaveFileReceipt } from '../src/motionscaper/desktop-file-contract.ts';
import { withProjectFileExtension } from '../src/common/project-file-extensions.ts';
import { acknowledgeMotionSaveRecovery, createMotionSavePublication, recoverMotionSavePublication, type MotionSavePublication, type MotionSavePublicationOptions } from './motion-save-publication.ts';
import { assertMotionSaveDirectory, captureMotionSaveDirectory, motionSaveTemporaryPath, readMotionSaveJournal, sameMotionSaveFile, type MotionSaveDirectoryIdentity } from './motion-save-publication-journal.ts';
import { MOTION_SAVED_FILE_MAXIMUM_BYTES } from '../src/common/editor/motion-saved-file-contract.ts';

interface Fingerprint { readonly dev: number; readonly ino: number; readonly size: number; readonly mtimeMs: number; readonly ctimeMs: number }
interface Binding { readonly path: string; readonly fingerprint: Fingerprint | null }
interface ReadCapability extends Binding { readonly file: FileHandle; readonly fingerprint: Fingerprint; readonly parent: MotionSaveDirectoryIdentity; readonly recoveredPublication?: MotionRecoveredPublication; busy: boolean }
interface WriteCapability extends Binding { readonly projectId: string; readonly saveCopy: boolean; readonly transactionId: string; readonly parent: MotionSaveDirectoryIdentity; readonly temporary: string; readonly file: FileHandle; readonly digest: Hash; publication?: MotionSavePublication; flight?: Promise<void>; bytes: number; busy: boolean; failed: boolean; closed: boolean }
interface RecoveryCapability { readonly path: string; readonly parent: MotionSaveDirectoryIdentity; readonly projectId: string; readonly recoveredPublication: MotionRecoveredPublication; busy: boolean }
interface OpeningFile { readonly file: FileHandle; readonly save?: Readonly<{ path: string; parent: MotionSaveDirectoryIdentity; temporary: string }>; closed: boolean; failed?: boolean }
export interface MotionFileDialogs {
	chooseOpen(): Promise<string | null>;
	chooseSave(options: { readonly suggestedName: string; readonly defaultPath?: string }): Promise<string | null>;
}
export interface MotionFileAuthority extends MotionDesktopFiles {
	/** Main-process OS file launch only; deliberately absent from the renderer method table. */
	openTrustedPath(path: string): Promise<MotionOpenFileCapability>;
	revokeRead(token: string): Promise<void>;
	dispose(): Promise<void>;
}

/** Capabilities live only in this main-process instance; no path crosses the renderer bridge. */
export function createMotionscaperFileAuthority(dialogs: MotionFileDialogs, options: MotionSavePublicationOptions = {}): MotionFileAuthority {
	const readers = new Map<string, ReadCapability>();
	const writers = new Map<string, WriteCapability>();
	const recoveries = new Map<string, RecoveryCapability>(), recoveryTokens = new Set<string>();
	const bindings = new Map<string, Binding>();
	const saving = new Set<string>();
	const completed = new Map<string, MotionSaveFileReceipt | null>();
	const released = new Set<string>();
	const admitted = new Set<Promise<unknown>>(), openingFiles = new Set<OpeningFile>();
	let disposing: Promise<void> | null = null;
	let disposed = false; let opening = 0;
	function track<Value>(action: () => Promise<Value>): Promise<Value> {
		let resolve!: (value: Value | PromiseLike<Value>) => void, reject!: (reason: unknown) => void;
		const promise = new Promise<Value>((complete, fail) => { resolve = complete; reject = fail; }); admitted.add(promise);
		void promise.then(() => { admitted.delete(promise); }, () => { admitted.delete(promise); });
		try { void action().then(resolve, reject); } catch (error) { reject(error); } return promise;
	}
	async function closeOpening(value: OpeningFile): Promise<void> {
		if (!value.closed) { await value.file.close(); value.closed = true; }
		if (value.save) { await assertMotionSaveDirectory(value.save.path, value.save.parent); await rm(value.save.temporary, { force: true }); }
		openingFiles.delete(value);
	}
	const active = () => { if (disposed) throw new Error('Motionscaper file authority is closed.'); };
	function reader(token: string): ReadCapability { active(); const value = readers.get(token); if (!value) throw new Error('Unknown Motionscaper read capability.'); return value; }
	function writer(token: string): WriteCapability { active(); const value = writers.get(token); if (!value) throw new Error('Unknown Motionscaper write capability.'); return value; }
	function beginOperation(value: WriteCapability): () => void {
		value.busy = true; let release!: () => void;
		value.flight = new Promise<void>(resolve => { release = resolve; });
		return () => { value.busy = false; delete value.flight; release(); };
	}
	function remember(token: string, receipt: MotionSaveFileReceipt | null): void {
		completed.set(token, receipt);
		while (completed.size > 256) { const retired = completed.keys().next().value!; completed.delete(retired); recoveryTokens.delete(retired); }
	}
	async function settleRecovered(path: string, recovered: MotionRecoveredPublication): Promise<void> {
		for (const [token, value] of writers) if (value.path === path && value.transactionId === recovered.transactionId) {
			if (value.busy) throw new Error('The recovered Motion Save still has an active operation.');
			if (!value.closed) { await value.file.close(); value.closed = true; }
			remember(token, { name: basename(path), ...recovered }); writers.delete(token); saving.delete(value.projectId);
		}
		for (const [token, value] of recoveries) if (value.path === path && value.recoveredPublication.transactionId === recovered.transactionId) {
			remember(token, { name: basename(path), ...recovered }); recoveries.delete(token); saving.delete(value.projectId);
		}
	}
	async function recoveryStatus(value: RecoveryCapability): Promise<MotionSaveFileReceipt> {
		await assertMotionSaveDirectory(value.path, value.parent);
		const current = await readMotionSaveJournal(value.path), expected = value.recoveredPublication;
		if (current && (current.journal.projectId !== value.projectId || current.journal.transactionId !== expected.transactionId || current.journal.phase !== expected.publication ||
			current.journal.sha256 !== expected.sha256 || current.journal.candidate.size !== expected.byteLength)) throw new Error('Motion Save recovery transaction ownership changed.');
		return { name: basename(value.path), ...expected };
	}
	async function acquireRead(choosePath: () => Promise<string | null>): Promise<MotionOpenFileCapability | null> {
		active(); if (readers.size + opening + [...openingFiles].filter(value => !value.save && value.failed).length >= 16) throw new RangeError('Too many open Motionscaper file capabilities.');
		opening += 1;
		try {
			const path = await choosePath(); if (path === null) return null; active();
			if (!isAbsolute(path)) throw new TypeError('A native Motionscaper dialog must select an absolute path.');
			const idleWriter = [...writers.values()].find(value => value.path === path);
			if (idleWriter && (idleWriter.busy || !idleWriter.publication)) throw new Error('A Motionscaper Save is active for this selected archive.');
			if (idleWriter && !idleWriter.closed) { await idleWriter.file.close(); idleWriter.closed = true; }
			const parent = await captureMotionSaveDirectory(path), priorJournal = await readMotionSaveJournal(path);
			const recoveredPublication = await recoverMotionSavePublication(path, options, parent);
			await assertMotionSaveDirectory(path, parent);
			const fingerprint = await requireFile(path);
			const bound = idleWriter ? bindings.get(idleWriter.projectId) : undefined;
			if (idleWriter && recoveredPublication?.publication === 'rolled-back' && bound?.path === path &&
				(sameMotionSaveFile(priorJournal?.journal.backup, fingerprint) || sameMotionSaveFile(priorJournal?.journal.previous, fingerprint))) bindings.set(idleWriter.projectId, { path, fingerprint });
			const file = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
			const held: OpeningFile = { file, closed: false }; openingFiles.add(held);
			try {
				assertFingerprint(fingerprint, fingerprintOf(await file.stat())); active();
				const token = randomUUID(); readers.set(token, { path, parent, fingerprint, file, busy: false, ...(recoveredPublication ? { recoveredPublication } : {}) });
				openingFiles.delete(held);
				return { token, name: basename(path), byteLength: fingerprint.size, ...(recoveredPublication ? { recoveredPublication } : {}) };
			} catch (error) { try { await closeOpening(held); } catch (cleanup) { held.failed = true; throw new AggregateError([error, cleanup], 'Motionscaper read admission cleanup failed.', { cause: cleanup }); } throw error; }
		} finally { opening -= 1; }
	}
	const authority: MotionFileAuthority = {
		selectOpen: () => acquireRead(() => dialogs.chooseOpen()),
		async openTrustedPath(path) {
			const selected = await acquireRead(() => Promise.resolve(path));
			if (!selected) throw new Error('Motionscaper native launch has no archive.');
			return selected;
		},
		async revokeRead(token) {
			const value = readers.get(token); if (!value) return;
			await value.file.close(); if (readers.get(token) === value) readers.delete(token);
		},
		async read({ token, offset, length }) {
			const value = reader(token); integer(offset, 'read offset'); integer(length, 'read length');
			if (length > MOTIONSCAPER_FILE_CHUNK_BYTES || offset > value.fingerprint.size - length) throw new RangeError('Motionscaper read chunk is outside its bounded capability.');
			if (value.busy) throw new Error('Motionscaper read capability already has a pending chunk.');
			value.busy = true;
			try {
				assertFingerprint(value.fingerprint, fingerprintOf(await value.file.stat()));
				const bytes = new Uint8Array(length); let read = 0;
				while (read < length) {
					const result = await value.file.read(bytes, read, length - read, offset + read);
					if (!result.bytesRead) throw new Error('Motionscaper selected archive changed during read.');
					read += result.bytesRead;
				}
				assertFingerprint(value.fingerprint, fingerprintOf(await value.file.stat())); return bytes;
			} finally { value.busy = false; }
		},
		async release({ token, acknowledgeRecovery = false }) {
			active(); if (typeof acknowledgeRecovery !== 'boolean') throw new TypeError('Invalid Motion Save recovery acknowledgement flag.');
			if (released.has(token)) return;
			const value = reader(token);
			if (acknowledgeRecovery) {
				if (!value.recoveredPublication) throw new Error('This read capability has no recovered Motion Save to acknowledge.');
				await acknowledgeMotionSaveRecovery(value.path, value.recoveredPublication.transactionId, value.parent, options);
				await settleRecovered(value.path, value.recoveredPublication);
			}
			await value.file.close(); readers.delete(token); released.add(token);
			while (released.size > 256) released.delete(released.values().next().value!);
		},
		async bindOpened({ token, projectId }) {
			const value = reader(token); identity(projectId);
			if (!bindings.has(projectId) && bindings.size >= 256) throw new RangeError('Too many Motionscaper file bindings.');
			const recoveryId = value.recoveredPublication?.transactionId;
			const ownsRecovery = recoveryId && ([...writers.values()].some(writer => writer.projectId === projectId && writer.path === value.path && writer.transactionId === recoveryId)
				|| [...recoveries.values()].some(recovery => recovery.projectId === projectId && recovery.path === value.path && recovery.recoveredPublication.transactionId === recoveryId));
			if (saving.has(projectId) && !ownsRecovery) throw new Error('A Motionscaper save for this project is already active.');
			assertFingerprint(value.fingerprint, await requireFile(value.path));
			if (value.recoveredPublication) {
				await acknowledgeMotionSaveRecovery(value.path, value.recoveredPublication.transactionId, value.parent, options);
				await settleRecovered(value.path, value.recoveredPublication);
			}
			bindings.set(projectId, { path: value.path, fingerprint: value.fingerprint });
		},
		async beginSave({ projectId, suggestedName, saveAs, saveCopy = false }) {
			active(); identity(projectId);
			if (typeof saveAs !== 'boolean' || typeof suggestedName !== 'string' || suggestedName.length > 512) throw new TypeError('Motionscaper Save requires a bounded name and saveAs boolean.');
			if (typeof saveCopy !== 'boolean' || saveCopy && !saveAs) throw new TypeError('Motionscaper Save Copy requires saveAs and a boolean saveCopy flag.');
			const wasSaving = saving.has(projectId), ownWriter = [...writers.values()].find(value => value.projectId === projectId);
			if (wasSaving && ![...recoveries.values()].some(value => value.projectId === projectId) && (!ownWriter?.publication || ownWriter.busy) || !wasSaving && saving.size >= 4) throw new Error('A Motionscaper save is already active.');
			saving.add(projectId);
			let retained = wasSaving;
			try {
				const bound = bindings.get(projectId);
				let path: string;
				const useBinding = !saveAs && bound && extname(bound.path).toLowerCase() === '.mscape';
				if (useBinding) path = bound.path;
				else {
					const chosen = await dialogs.chooseSave({ suggestedName: safeName(suggestedName), ...(bound && !saveCopy ? { defaultPath: withProjectFileExtension(bound.path, '.mscape') } : {}) });
					if (chosen === null) { if (!wasSaving) saving.delete(projectId); return null; }
					active();
					if (!isAbsolute(chosen) || extname(chosen).toLowerCase() !== '.mscape') throw new TypeError('Choose a Motionscaper .mscape destination.');
					path = chosen;
				}
				const parent = await captureMotionSaveDirectory(path), pending = await readMotionSaveJournal(path);
				if (pending) {
					if (pending.journal.projectId !== projectId) throw new Error('The selected native Save recovery belongs to another project.');
					const idle = [...writers.values()].find(value => value.path === path);
					if (idle && (idle.busy || !idle.publication || idle.transactionId !== pending.journal.transactionId)) throw new Error('A pending Motion Save still owns this destination.');
					if (idle && !idle.closed) { await idle.file.close(); idle.closed = true; }
					const recoveredPublication = await recoverMotionSavePublication(path, options, parent);
					if (!recoveredPublication) throw new Error('The selected native Save recovery disappeared.');
					if (idle && recoveredPublication.publication === 'rolled-back' && bound?.path === path) {
						// Refresh only our known rollback inode; current archive admission belongs to the next ordinary Save.
						const restored = await optionalFile(path).catch(() => null);
						if (restored && (sameMotionSaveFile(pending.journal.backup, restored) || sameMotionSaveFile(pending.journal.previous, restored))) bindings.set(projectId, { path, fingerprint: restored });
					}
					const existing = [...recoveries.entries()].find(([, value]) => value.path === path && value.projectId === projectId && value.recoveredPublication.transactionId === recoveredPublication.transactionId);
					if (existing) {
						if (JSON.stringify(existing[1].recoveredPublication) !== JSON.stringify(recoveredPublication)) throw new Error('The native Save recovery outcome changed.');
						return { token: existing[0], recoveredPublication };
					}
					if (recoveries.size >= 4) throw new Error('Finish a pending native Save recovery before selecting another.');
					const token = randomUUID(); recoveries.set(token, { path, parent, projectId, recoveredPublication, busy: false }); recoveryTokens.add(token); retained = true;
					return { token, recoveredPublication };
				}
				if (wasSaving) throw new Error('Finish the active Motion Save recovery before starting another Save.');
				if (!saveCopy && !bindings.has(projectId) && bindings.size >= 256) throw new RangeError('Too many Motionscaper file bindings.');
				const fingerprint = await optionalFile(path); if (useBinding) assertFingerprint(bound.fingerprint, fingerprint);
				if (saveCopy && bound && (path === bound.path || fingerprint && bound.fingerprint
					&& fingerprint.dev === bound.fingerprint.dev && fingerprint.ino === bound.fingerprint.ino)) throw new Error('Save Copy requires an independent destination.');
				if (saveCopy && [...readers.values()].some(value => path === value.path || fingerprint
					&& fingerprint.dev === value.fingerprint.dev && fingerprint.ino === value.fingerprint.ino)) throw new Error('Save Copy requires an independent destination from every retained open archive.');
				if ([...writers.values()].some(value => value.path === path) || await readMotionSaveJournal(path)) throw new Error('A pending Motionscaper Save owns this destination; finish or recover it first.');
				active();
				const transactionId = randomUUID(), temporary = motionSaveTemporaryPath(path, transactionId);
				const file = await open(temporary, 'wx', 0o600);
				const held: OpeningFile = { file, save: { path, parent, temporary }, closed: false }; openingFiles.add(held);
				try {
					await assertMotionSaveDirectory(path, parent); active();
					const token = randomUUID(); writers.set(token, { path, parent, fingerprint, projectId, saveCopy, transactionId, temporary, file, digest: createHash('sha256'), bytes: 0, busy: false, failed: false, closed: false });
					openingFiles.delete(held); retained = true; return { token };
				} catch (error) { try { await closeOpening(held); } catch (cleanup) { retained = true; throw new AggregateError([error, cleanup], 'Motionscaper Save admission cleanup failed.', { cause: cleanup }); } throw error; }
			} catch (error) { if (!retained) saving.delete(projectId); throw error; }
		},
		async write({ token, offset, bytes }) {
			if (recoveryTokens.has(token)) throw new Error('A native Save recovery capability cannot write archive bytes.');
			const value = writer(token); integer(offset, 'write offset');
			if (offset !== value.bytes) throw new RangeError('Motionscaper write offset must follow the last committed chunk.');
			if (!(bytes instanceof Uint8Array) || bytes.byteLength < 1 || bytes.byteLength > MOTIONSCAPER_FILE_CHUNK_BYTES) throw new RangeError('Motionscaper write chunk exceeds its bounded capability.');
			if (offset > MOTION_SAVED_FILE_MAXIMUM_BYTES - bytes.byteLength) throw new RangeError('Motionscaper archive exceeds its 64 GiB file admission.');
			if (value.busy || value.failed || value.closed) throw new Error('Motionscaper write capability is busy, failed or closed.');
			const chunk = new Uint8Array(bytes);
			const finish = beginOperation(value);
			try {
				let written = 0;
				while (written < chunk.byteLength) {
					const result = await value.file.write(chunk, written, chunk.byteLength - written, offset + written);
					if (!result.bytesWritten) throw new Error('Motionscaper archive write made no progress.');
					written += result.bytesWritten;
				}
				value.digest.update(chunk); value.bytes += chunk.byteLength;
			} catch (error) { value.failed = true; throw error; }
			finally { finish(); }
		},
		async commit({ token, byteLength, phase }) {
			active();
			if (phase !== undefined && phase !== 'prepare' && phase !== 'publish' && phase !== 'status') throw new TypeError('Invalid Motionscaper commit phase.');
			if (recoveryTokens.has(token)) {
				if (phase !== 'status') throw new Error('A native Save recovery capability permits only status and acknowledgement.');
				const recovery = recoveries.get(token), receipt = recovery ? await recoveryStatus(recovery) : completed.get(token);
				if (!receipt || receipt.byteLength !== byteLength) throw new Error('The native Save recovery receipt does not match this request.');
				return receipt;
			}
			const prior = completed.get(token);
			if (phase && prior) {
				if (prior.byteLength !== byteLength || phase === 'publish' && prior.publication !== 'published') throw new Error('Motion Save completed receipt does not authorize this request.');
				return prior;
			}
			const value = writer(token); integer(byteLength, 'archive byte length');
			if (byteLength < 1 || value.bytes !== byteLength || value.busy || value.failed) throw new RangeError('Motionscaper archive is incomplete or its write capability failed.');
			const finish = beginOperation(value);
			try {
				value.publication ??= createMotionSavePublication({ path: value.path, parent: value.parent, temporary: value.temporary, file: value.file, expected: value.fingerprint,
					projectId: value.projectId, transactionId: value.transactionId, byteLength, sha256: value.digest.copy().digest('hex'), ...options,
					async close() { if (!value.closed) { await value.file.close(); value.closed = true; } },
				});
				if (phase === 'status') return await value.publication.status();
				if (phase === 'prepare') return await value.publication.prepare();
				if (phase === undefined) await value.publication.prepare();
				const receipt = await value.publication.publish();
				// Preparation already verified this identity; binding observation after publication cannot revoke the saved outcome.
				if (!value.saveCopy) {
					try {
						const current = await readMotionSaveJournal(value.path), fingerprint = await requireFile(value.path);
						if (current?.journal.transactionId !== value.transactionId || !sameMotionSaveFile(current.journal.candidate, fingerprint)) throw new Error('The published Motion Save destination changed before binding.');
						bindings.set(value.projectId, { path: value.path, fingerprint });
					}
					catch (error) { return { ...receipt, cleanupError: error instanceof Error ? error.message : String(error) }; }
				}
				if (phase === undefined) {
					await value.publication.abort(true); writers.delete(token); saving.delete(value.projectId); remember(token, receipt);
				}
				return receipt;
			} finally { finish(); }
		},
		async cancel({ token, acknowledge = false }) {
			active();
			if (typeof acknowledge !== 'boolean') throw new TypeError('Invalid Motionscaper acknowledgement flag.');
			if (completed.has(token)) return;
			const recovery = recoveries.get(token);
			if (recovery) {
				if (recovery.busy) throw new Error('Native Save recovery acknowledgement is already active.');
				if (!acknowledge) { await recoveryStatus(recovery); return; }
				recovery.busy = true;
				try {
					await recoveryStatus(recovery); await acknowledgeMotionSaveRecovery(recovery.path, recovery.recoveredPublication.transactionId, recovery.parent, options);
					await settleRecovered(recovery.path, recovery.recoveredPublication);
				} finally { recovery.busy = false; }
				return;
			}
			const value = writer(token);
			if (value.busy) throw new Error('Motionscaper write capability is busy.');
			const finish = beginOperation(value);
			try {
				if (value.publication) {
					let finalReceipt = acknowledge ? await value.publication.status().catch(() => null) : null;
					const restored = await value.publication.abort(acknowledge);
					if (restored !== undefined && !value.saveCopy) bindings.set(value.projectId, { path: value.path, fingerprint: restored });
					if (!acknowledge && await readMotionSaveJournal(value.path)) return;
					if (acknowledge) finalReceipt = await value.publication.status().catch(() => finalReceipt);
					remember(token, finalReceipt);
				} else {
					if (!value.closed) { await value.file.close(); value.closed = true; }
					await rm(value.temporary, { force: true }); remember(token, null);
				}
				writers.delete(token); saving.delete(value.projectId);
			} finally { finish(); }
		},
		dispose() {
			if (disposing) return disposing; disposed = true;
			const operation = Promise.resolve().then(async () => {
				while (admitted.size) await Promise.allSettled([...admitted]);
				const results = await Promise.allSettled([
					...[...openingFiles].map(closeOpening),
					...[...readers].map(async ([token, value]) => { await value.file.close(); readers.delete(token); }),
					...[...writers].map(async ([token, value]) => {
						await value.flight;
						if (value.publication) await value.publication.abort();
						else { if (!value.closed) { await value.file.close(); value.closed = true; } await assertMotionSaveDirectory(value.path, value.parent); await rm(value.temporary, { force: true }); }
						writers.delete(token); saving.delete(value.projectId);
					}),
				]);
				const failures = results.flatMap(result => result.status === 'rejected' ? [result.reason as unknown] : []);
				if (failures.length) throw new AggregateError(failures, 'Motionscaper file cleanup failed.');
				recoveries.clear(); bindings.clear(); saving.clear();
			});
			disposing = operation;
			void operation.catch(() => { if (disposing === operation) disposing = null; }); return operation;
		},
	};
	return Object.freeze({ ...authority,
		selectOpen: () => track(() => authority.selectOpen()), openTrustedPath: (path: string) => track(() => authority.openTrustedPath(path)),
		revokeRead: (token: string) => track(() => authority.revokeRead(token)),
		read: (request: Parameters<MotionFileAuthority['read']>[0]) => track(() => authority.read(request)),
		release: (request: Parameters<MotionFileAuthority['release']>[0]) => track(() => authority.release(request)),
		bindOpened: (request: Parameters<MotionFileAuthority['bindOpened']>[0]) => track(() => authority.bindOpened(request)),
		beginSave: (request: Parameters<MotionFileAuthority['beginSave']>[0]) => track(() => authority.beginSave(request)),
		write: (request: Parameters<MotionFileAuthority['write']>[0]) => track(() => authority.write(request)),
		commit: (request: Parameters<MotionFileAuthority['commit']>[0]) => track(() => authority.commit(request)),
		cancel: (request: Parameters<MotionFileAuthority['cancel']>[0]) => track(() => authority.cancel(request)),
	});
}
function integer(value: number, label: string): void { if (!Number.isSafeInteger(value) || value < 0) throw new RangeError(`Invalid Motionscaper ${label}.`); }
function identity(value: string): void { if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(value)) throw new TypeError('Invalid Motionscaper project identity.'); }
function safeName(value: string): string {
	const name = withProjectFileExtension(value.replace(/[\\/\p{Cc}<>:"|?*]/gu, '_').trim() || 'Motionscaper project', '.mscape');
	return `${name.slice(0, -'.mscape'.length).slice(0, 180) || 'Motionscaper project'}.mscape`;
}
function fingerprintOf(value: Fingerprint): Fingerprint { return { dev: value.dev, ino: value.ino, size: value.size, mtimeMs: value.mtimeMs, ctimeMs: value.ctimeMs }; }
function assertFingerprint(expected: Fingerprint | null, actual: Fingerprint | null): void { if (JSON.stringify(expected) !== JSON.stringify(actual)) throw new Error('The selected Motionscaper archive changed outside this save.'); }
async function optionalFile(path: string): Promise<Fingerprint | null> {
	if (!isAbsolute(path)) throw new TypeError('A native Motionscaper dialog must select an absolute path.');
	const stats = await lstat(path).catch((error: unknown) => { if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') return null; throw error; });
	if (!stats) return null;
	if (!stats.isFile() || stats.isSymbolicLink() || !Number.isSafeInteger(stats.size)) throw new TypeError('Motionscaper file capability requires a regular file.');
	return fingerprintOf(stats);
}
async function requireFile(path: string): Promise<Fingerprint> { const value = await optionalFile(path); if (!value) throw new Error('Motionscaper selected archive no longer exists.'); return value; }
