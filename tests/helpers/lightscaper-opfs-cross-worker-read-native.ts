/* SPDX-License-Identifier: AGPL-3.0-only */
// Two real companions read one private OPFS file. No project store or writer
// remains open while the independently owned clients request snapshots.
import { OpfsSyncWorkerClient } from '../../src/common/editor/storage/opfs-sync-worker-client.ts';
declare function __assertCrossWorkerReadNativeEnvironment(): Promise<void>;

const BYTES = Object.freeze([3, 11, 29, 47, 61, 83, 107, 127, 149, 167, 181, 199, 211, 227, 239, 251,
	1, 19, 37, 53, 71, 89, 109, 131, 151, 173, 191, 209, 223, 233, 241, 253]);
function errorFields(error: unknown) {
	return error instanceof Error || error instanceof DOMException
		? { name: error.name.slice(0, 160), message: error.message.slice(0, 1024) }
		: { name: null, message: null };
}
function bounded<T>(work: Promise<T>, label: string, milliseconds = 4000): Promise<T> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	return new Promise<T>((resolve, reject) => {
		timer = setTimeout(() => reject(new Error('Native cross-worker fixture deadline: ' + label)), milliseconds);
		void work.then(resolve, reject);
	}).finally(() => { if (timer !== undefined) clearTimeout(timer); });
}
interface ReadFacts { size: number; bytes: number[]; exactBytes: boolean }
async function read(client: OpfsSyncWorkerClient, onStage: (stage: string) => void): Promise<ReadFacts> {
	onStage('production-snapshot-api');
	const blob = await client.snapshot('media-asset-chunk-read', 'fixture.bin');
	onStage('snapshot-body-materialization');
	if (blob.size !== BYTES.length) throw new Error('Tiny snapshot size changed: ' + String(blob.size));
	const backing = await bounded(blob.arrayBuffer(), 'tiny snapshot body');
	try {
		const bytes = Array.from(new Uint8Array(backing));
		return { size: blob.size, bytes, exactBytes: bytes.length === BYTES.length && bytes.every((v, i) => v === BYTES[i]) };
	} finally { new Uint8Array(backing).fill(0); }
}
export async function runLightscaperOpfsCrossWorkerReadNative() {
	const clients = [new OpfsSyncWorkerClient({ workerName: 'lightscaper-cross-worker-reader-A', timeoutMs: 2000 }),
		new OpfsSyncWorkerClient({ workerName: 'lightscaper-cross-worker-reader-B', timeoutMs: 2000 })];
	const observations: Array<Record<string, unknown>> = [], batch: Array<Record<string, unknown>> = [];
	const cleanup: Record<string, unknown> = {};
	let root: FileSystemDirectoryHandle | undefined, privateName: string | undefined;
	let writer: FileSystemWritableFileStream | undefined, setupError: ReturnType<typeof errorFields> | undefined;
	async function control(phase: string, index: number) {
		let stage = 'not-started'; const started = performance.now();
		try {
			const value = await bounded(read(clients[index]!, next => { stage = next; }), phase);
			observations.push({ phase, client: index, status: 'fulfilled', stage, startedMs: started, endedMs: performance.now(), ...value });
		} catch (error) { observations.push({ phase, client: index, status: 'rejected', stage,
			startedMs: started, endedMs: performance.now(), error: errorFields(error) }); }
	}
	try {
		root = await bounded(navigator.storage.getDirectory(), 'OPFS root');
		privateName = 'lightscaper-cross-worker-read-' + crypto.randomUUID();
		const directory = await bounded(root.getDirectoryHandle(privateName, { create: true }), 'private directory');
		const file = await bounded(directory.getFileHandle('fixture.bin', { create: true }), 'private tiny file');
		writer = await bounded(file.createWritable(), 'tiny setup writer');
		await bounded(writer.write(new Uint8Array(BYTES)), 'tiny setup write');
		await bounded(writer.close(), 'tiny setup writer close'); writer = undefined;
		cleanup.setupWriterClosedBeforeReads = true;
		const initialized = await bounded(Promise.all(clients.map(client => client.initialize(directory))), 'both real companion initializations');
		if (initialized.some(value => value !== true)) throw new Error('Both real synchronous production companions are required.');
		await bounded(__assertCrossWorkerReadNativeEnvironment(), 'both initialized native environments');
		for (let i = 0; i < clients.length; i++) await control('before-concurrent-batch', i);
		const jobs: Array<{ client: number; ordinal: number; startedMs: number; endedMs?: number; stage: string }> = [];
		const pending: Array<Promise<ReadFacts>> = [];
		for (let ordinal = 0; ordinal < 8; ordinal++) for (let client = 0; client < clients.length; client++) {
			const row = { client, ordinal, startedMs: performance.now(), endedMs: undefined as number | undefined, stage: 'not-started' };
			jobs.push(row);
			pending.push(read(clients[client]!, stage => { row.stage = stage; }).finally(() => { row.endedMs = performance.now(); }));
		}
		const results = await bounded(Promise.allSettled(pending), 'one16-request two-client batch', 5000);
		for (let i = 0; i < results.length; i++) {
			const result = results[i]!, row = jobs[i]!;
			batch.push({ ...row, status: result.status, ...(result.status === 'fulfilled' ? result.value : { error: errorFields(result.reason) }) });
		}
		for (let i = 0; i < clients.length; i++) await control('after-concurrent-batch', i);
		const final = await bounded(file.getFile(), 'final native File');
		if (final.size !== BYTES.length) throw new Error('Final tiny file size changed.');
		const backing = await bounded(final.arrayBuffer(), 'final tiny bytes');
		try { cleanup.finalBytes = Array.from(new Uint8Array(backing)); }
		finally { new Uint8Array(backing).fill(0); }
	} catch (error) { setupError = errorFields(error); }
	finally {
		if (writer) try { await bounded(writer.abort(), 'tiny setup writer abort'); cleanup.writerAborted = true; }
		catch (error) { cleanup.writerAbortError = errorFields(error); }
		for (const client of clients) client.close(); cleanup.clientsClosed = 2;
		if (root && privateName) try {
			await bounded(root.removeEntry(privateName, { recursive: true }), 'exact private directory removal');
			cleanup.privateDirectoryRemoved = true;
		} catch (error) { cleanup.privateDirectoryRemovalError = errorFields(error); }
	}
	return { setupError, observations, batch, cleanup,
		directorySameHandleSentToBoth: true, snapshotsRequestedPerClient: 8, holderUsed: false,
	};
}
