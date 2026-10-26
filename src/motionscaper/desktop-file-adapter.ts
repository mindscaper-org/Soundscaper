/* SPDX-License-Identifier: AGPL-3.0-only */
import { createScapeArchiveByteSource, type ScapeArchiveByteSource } from '../common/editor/scape-archive-byte-source.ts';
import { MOTIONSCAPER_FILE_CHUNK_BYTES, MOTIONSCAPER_FILE_METHODS, type MotionDesktopFiles, type MotionSaveFileReceipt, type MotionRecoveredPublication } from './desktop-file-contract.ts';

export interface MotionDesktopArchiveInput {
	readonly input: ScapeArchiveByteSource; readonly name: string;
	readonly recoveredPublication?: MotionRecoveredPublication;
	markRecoveryReconciled?(): void;
	bind(projectId: string): Promise<void>; release(): Promise<void>;
}
export interface MotionDesktopArchiveSelection extends MotionDesktopArchiveInput { markRecoveryReconciled(): void }
export interface MotionDesktopArchiveOutput {
	readonly writable: WritableStream<Uint8Array>;
	readonly recoveredPublication?: MotionRecoveredPublication;
	prepare(): Promise<MotionSaveFileReceipt>;
	commit(): Promise<MotionSaveFileReceipt>;
	status(): Promise<MotionSaveFileReceipt>;
	abort(): Promise<void>;
	acknowledge(): Promise<void>;
}
export function motionscaperDesktopFiles(value: unknown = globalThis): MotionDesktopFiles | null {
	const global = value as { scapeDesktop?: { v1?: { motionFiles?: unknown } } } | null;
	const files = global?.scapeDesktop?.v1?.motionFiles;
	if (!files || typeof files !== 'object') return null;
	if (!MOTIONSCAPER_FILE_METHODS.every((method) => typeof (files as Record<string, unknown>)[method] === 'function')) throw new TypeError('Motionscaper desktop file bridge is incomplete.');
	return files as MotionDesktopFiles;
}

/** The importer sees bounded archive bytes and never receives a filesystem path. */
export async function selectMotionscaperDesktopArchive(files: MotionDesktopFiles, signal?: AbortSignal): Promise<MotionDesktopArchiveSelection | null> {
	signal?.throwIfAborted(); const selected = await files.selectOpen();
	if (!selected) return null;
	let released = false; let releasing: Promise<void> | null = null; let recoveryReconciled = false;
	const release = async () => {
		if (released) return;
		releasing ??= files.release({ token: selected.token, ...(recoveryReconciled ? { acknowledgeRecovery: true } : {}) });
		try { await releasing; released = true; } finally { releasing = null; }
	};
	if (signal?.aborted) { await release(); signal.throwIfAborted(); }
	return Object.freeze({ name: selected.name, ...(selected.recoveredPublication ? { recoveredPublication: selected.recoveredPublication } : {}),
		markRecoveryReconciled() { if (selected.recoveredPublication) recoveryReconciled = true; },
		input: createScapeArchiveByteSource({ size: selected.byteLength, maximumReadBytes: MOTIONSCAPER_FILE_CHUNK_BYTES,
			read: async ({ offset, length, signal: readSignal }) => {
				if (released || releasing) throw new Error('Motionscaper archive capability was released.');
				signal?.throwIfAborted(); readSignal?.throwIfAborted();
				const bytes = await files.read({ token: selected.token, offset, length });
				signal?.throwIfAborted(); readSignal?.throwIfAborted(); return bytes;
			},
		}),
		bind: async (projectId: string) => { if (released) throw new Error('Motionscaper archive capability was released.'); await files.bindOpened({ token: selected.token, projectId }); },
		release,
	});
}

/** File commit is explicit and must finish before publishing the revision to the project store. */
export async function beginMotionscaperDesktopSave(files: MotionDesktopFiles, options: {
	readonly projectId: string; readonly suggestedName: string; readonly saveAs?: boolean; readonly saveCopy?: boolean; readonly signal?: AbortSignal;
}): Promise<MotionDesktopArchiveOutput | null> {
	options.signal?.throwIfAborted();
	const selected = await files.beginSave({ projectId: options.projectId, suggestedName: options.suggestedName,
		saveAs: options.saveAs ?? false, ...(options.saveCopy === undefined ? {} : { saveCopy: options.saveCopy }) });
	if (!selected) return null;
	const recovery = selected.recoveredPublication;
	let offset = recovery?.byteLength ?? 0; let closed = false; let terminal = false; let aborting = false; let cancellation: Promise<void> | null = null;
	let prepared: MotionSaveFileReceipt | null = null, published: MotionSaveFileReceipt | null = null, acknowledged = false, rolledBack = false;
	let pending: Promise<void> = Promise.resolve();
	const abort = async () => {
		if (terminal || acknowledged || rolledBack) return; aborting = true;
		cancellation ??= (async () => { await pending.catch(() => undefined); await files.cancel({ token: selected.token }); rolledBack = true; })();
		try { await cancellation; } finally { cancellation = null; }
	};
	const acknowledge = async () => {
		if (terminal || acknowledged) return;
		await pending.catch(() => undefined); await files.cancel({ token: selected.token, acknowledge: true }); acknowledged = true;
	};
	function validate(value: MotionSaveFileReceipt, publication?: MotionSaveFileReceipt['publication']): MotionSaveFileReceipt {
		if ((publication !== undefined && value.publication !== publication) || !['prepared', 'published', 'rolled-back'].includes(value.publication ?? '') ||
			typeof value.transactionId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/u.test(value.transactionId) || value.byteLength !== offset || !/^[a-f0-9]{64}$/u.test(value.sha256) ||
			(prepared && (prepared.transactionId !== value.transactionId || prepared.sha256 !== value.sha256)) ||
			(recovery && (recovery.transactionId !== value.transactionId || recovery.sha256 !== value.sha256 || recovery.publication !== value.publication))) throw new Error('Native Motion Save receipt does not authorize this prepared archive.');
		return value;
	}
	if (options.signal?.aborted) { await abort(); options.signal.throwIfAborted(); }
	const writable = new WritableStream<Uint8Array>({
		write(chunk) {
			if (recovery) throw new Error('This native Save recovery capability cannot write a replacement archive.');
			if (terminal || aborting) throw new Error('Motionscaper archive save is closed.');
			if (!(chunk instanceof Uint8Array)) throw new TypeError('Motionscaper archive output requires byte chunks.');
			const snapshot = new Uint8Array(chunk);
			pending = (async () => {
				for (let cursor = 0; cursor < snapshot.byteLength; cursor += MOTIONSCAPER_FILE_CHUNK_BYTES) {
					options.signal?.throwIfAborted();
					const bytes = snapshot.subarray(cursor, cursor + MOTIONSCAPER_FILE_CHUNK_BYTES);
					await files.write({ token: selected.token, offset, bytes }); offset += bytes.byteLength;
				}
			})();
			return pending;
		},
		close() { if (recovery) throw new Error('This native Save recovery capability has no archive stream.'); closed = true; }, abort,
	});
	return Object.freeze({ writable, abort, acknowledge, ...(recovery ? { recoveredPublication: recovery } : {}),
		async prepare() {
			if (recovery) throw new Error('This native Save recovery capability cannot prepare an archive.');
			if (!closed || terminal || aborting || published) throw new Error('Motionscaper archive must finish streaming before native preparation.');
			options.signal?.throwIfAborted();
			prepared = validate(await files.commit({ token: selected.token, byteLength: offset, phase: 'prepare' }), 'prepared'); return prepared;
		},
		async status() {
			const receipt = validate(await files.commit({ token: selected.token, byteLength: offset, phase: 'status' }));
			if (receipt.publication === 'prepared') prepared = receipt;
			if (receipt.publication === 'published') published = receipt;
			return receipt;
		},
		async commit() {
			if (recovery) throw new Error('This native Save recovery capability cannot publish an archive.');
			if (!closed || terminal || aborting) throw new Error('Motionscaper archive must finish streaming before file commit.');
			options.signal?.throwIfAborted();
			if (published) return published;
			const receipt = await files.commit({ token: selected.token, byteLength: offset, ...(prepared ? { phase: 'publish' as const } : {}) });
			if (prepared) { published = validate(receipt, 'published'); return published; }
			terminal = true; return receipt;
		},
	});
}
