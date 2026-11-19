/* SPDX-License-Identifier: AGPL-3.0-only */
import type { DesktopPhotoOriginalStorageCurrentV1 as Storage, DesktopPhotoOriginalDirectoryCurrentV1 as Directory } from '../desktop-photo-original-contract-current-v1.ts';
import { bindDebugMethodCurrentV1 as bind, debugCheckCurrentV1 as check, debugCleanupFailureCurrentV1 as cleanupFailure } from './photo-library-debug-soak-contract-current-v1.ts';

export interface DebugOutputWriterCurrentV1 {
	write(bytes: Uint8Array<ArrayBuffer>): Promise<void>;
	close(): Promise<void>;
	abort(reason?: unknown): Promise<void>;
}
export interface DebugOutputStageCurrentV1 {
	createWritable(): Promise<DebugOutputWriterCurrentV1>;
	read(): Promise<Blob>;
	remove(): Promise<void>;
}
const SIZE = Object.getOwnPropertyDescriptor(Blob.prototype, 'size')!.get!;

/** Keep the diagnostic's committed output private on browsers with either
 * OPFS writers or IndexedDB. Both routes acknowledge a persistent write and
 * independently read it back before their own output is removed. */
export async function createDebugOutputCurrentV1(storage: Storage | undefined, signal: AbortSignal): Promise<DebugOutputStageCurrentV1> {
	check(signal); const token = crypto.randomUUID();
	const indexed = async (): Promise<DebugOutputStageCurrentV1> => {
		check(signal);
		const { createIndexedDbDebugOutputCurrentV1 } = await import('./photo-library-debug-indexeddb-output-current-v1.ts');
		return createIndexedDbDebugOutputCurrentV1(globalThis.indexedDB, token);
	};
	if (typeof storage?.getDirectory !== 'function') return indexed();
	const root = await storage.getDirectory(); check(signal);
	const parent = await root.getDirectoryHandle('lightscaper-library-debug-soak-v1', { create: true }); check(signal);
	let stage: Directory | undefined;
	try {
		try { await parent.getDirectoryHandle(token, { create: false }); throw new Error('Diagnostic output namespace already exists.'); }
		catch (error) { if (!(error instanceof DOMException) || error.name !== 'NotFoundError') throw error; }
		stage = await parent.getDirectoryHandle(token, { create: true }); check(signal);
		const file = await stage.getFileHandle('diagnostic.png', { create: true }); check(signal);
		if (typeof file.createWritable !== 'function') {
			await parent.removeEntry(token, { recursive: true }); stage = undefined;
			return indexed();
		}
		const createWritable = bind(file.createWritable, file), getFile = bind(file.getFile, file);
		return {
			async createWritable() {
				const writer = await createWritable({ keepExistingData: false });
				const write = bind(writer.write, writer), close = bind(writer.close, writer), abort = bind(writer.abort, writer);
				return { async write(bytes) { await write(bytes); }, async close() { await close(); }, async abort(reason) { await abort(reason); } };
			},
			async read() { const body = await getFile(); Reflect.apply(SIZE, body, []); return body as Blob; },
			async remove() { await parent.removeEntry(token, { recursive: true }); },
		};
	} catch (error) {
		if (stage) {
			try { await parent.removeEntry(token, { recursive: true }); }
			catch (cleanup) { throw cleanupFailure([error], cleanup, { parent, stage }); }
		}
		throw error;
	}
}
