/* SPDX-License-Identifier: AGPL-3.0-only */
import { createProjectStore } from '../../src/common/editor/storage.js';
import { request, transact } from '../../src/common/editor/storage/indexeddb-backend.ts';
import { MediaAssetStagingLeaseError } from '../../src/common/editor/storage/media-asset-path-staging.ts';
import type { OpfsBlobWritePlan } from '../../src/common/editor/storage/opfs-blob-write-plan.ts';
import { LyingBlob } from './video-storage-opfs-model-fixture.ts';

type Mode = 'concurrent' | 'adversarial' | 'cascade' | 'trim' | 'cancel';
const ORIGINAL_SHA = 'ddc5852cf5d92b542ec7d6efcc6d9c02a53f9692fd5f36e954896c21c7a8ac4e';
/** Real browser IDB and OPFS only. No structural handle is native custody. */
export async function qualifyVideoStorageNativePublication(mode: Mode): Promise<Readonly<Record<string, unknown>>> {
	if (!['concurrent', 'adversarial', 'cascade', 'trim', 'cancel'].includes(mode)) throw new TypeError('Unknown native storage case.');
	ensure(isSecureContext && crossOriginIsolated, 'The real native worker environment must be secure and isolated.');
	const root = await navigator.storage.getDirectory(), name = `video-native-${crypto.randomUUID()}`;
	const privateRoot = await root.getDirectoryHandle(name, { create: true });
	const store = createProjectStore({ indexedDB, databaseName: name, memoryFallback: false, opfsRoot: privateRoot });
	let database: IDBDatabase | undefined, failed = false, primary: unknown, receipt: Readonly<Record<string, unknown>> | undefined;
	try {
		await store.ready(); database = await openExisting(name);
		const directory = await store.opfsRepository?.directory(); ensure(directory, 'Actual OPFS directory is unavailable.');
		ensure(await directory.isSameEntry(await privateRoot.getDirectoryHandle('audio-editor-sources')), 'Physical directory identity differs.');
		const result = mode === 'concurrent' ? await concurrent() : mode === 'adversarial' ? await adversarial()
			: mode === 'cancel' ? await cancelled() : await pcmAndDerivatives(mode);
		receipt = Object.freeze({ mode, nativeOpfs: true, nativeDatabase: store.getStatus().backend === 'indexeddb', ...result });
	} catch (error) { failed = true; primary = error; }
	const errors: unknown[] = [];
	try { await store.close(); } catch (error) { errors.push(error); }
	try { database?.close(); } catch (error) { errors.push(error); }
	if (!errors.length) {
		for (const cleanup of [() => removeDatabase(name), () => root.removeEntry(name, { recursive: true })]) {
			try { await cleanup(); } catch (error) { errors.push(error); }
		}
	}
	if (errors.length) throw new AggregateError([...(failed ? [primary] : []), ...errors], 'Actual native storage fixture did not retire.', { cause: failed ? primary : errors[0] });
	if (failed) throw primary;
	ensure(receipt, 'Actual native storage qualification returned no receipt.');
	return receipt;

	async function row(sourceId: string) {
		ensure(database, 'Actual database was not opened.');
		return transact(database, 'mediaAssets', 'readonly', stores => request(stores.mediaAssets!.get(sourceId)) as Promise<Record<string, unknown> | undefined>);
	}
	async function files(): Promise<string[]> {
		const directory = await store.opfsRepository?.directory(); ensure(directory, 'Actual directory was lost.');
		const entries: unknown = Reflect.get(directory, 'entries'); ensure(typeof entries === 'function', 'Native directory entries are unavailable.');
		const iterable = Reflect.apply(entries, directory, []) as AsyncIterable<[string, FileSystemHandle]>;
		const result: string[] = [];
		for await (const [path, handle] of iterable) { ensure(result.length < 16 && handle.kind === 'file', 'Unexpected native inventory.'); result.push(path); }
		return result.sort();
	}
	async function actualBody(sourceId: string, expected: string) {
		const retained = await row(sourceId); ensure(retained?.storage === 'opfs' && typeof retained.path === 'string', 'Original did not publish through genuine OPFS.');
		const directory = await store.opfsRepository?.directory(); ensure(directory, 'Actual directory missing.');
		const file = await (await directory.getFileHandle(retained.path)).getFile(); ensure(file instanceof File, 'Native snapshot is not a File.');
		ensure(await file.text() === expected, 'Physical Original differs.');
		const loaded = await store.loadMediaAsset(sourceId); ensure(loaded && new TextDecoder().decode(await loaded.arrayBuffer()) === expected, 'Loaded Original differs.'); return retained;
	}
	async function concurrent() {
		const outcomes = await Promise.allSettled([
			store.writeMediaAsset('shared-id', new Blob(['first']), { candidate: 'first' }),
			store.writeMediaAsset('shared-id', new Blob(['second']), { candidate: 'second' }),
		]);
		const winners = outcomes.filter(value => value.status === 'fulfilled'), losers = outcomes.filter(value => value.status === 'rejected');
		ensure(winners.length === 1 && losers.length === 1, 'Concurrent direct writes require exactly one immutable winner.');
		const loser: unknown = losers[0]!.reason;
		ensure(loser instanceof MediaAssetStagingLeaseError || loser instanceof Error && /Immutable media asset shared-id cannot be overwritten\./u.test(loser.message), 'Loser was not refused by immutable row or same-source staging custody.');
		const winner = winners[0]!.value; ensure(winner.candidate === 'first' || winner.candidate === 'second', 'Winner identity differs.');
		await actualBody('shared-id', winner.candidate); ensure((await files()).length === 1, 'Losing path was not removed.');
		ensure(database, 'Actual database missing.');
		const count = await transact(database, 'mediaAssets', 'readonly', stores => request(stores.mediaAssets!.count()));
		ensure(count === 1, 'Concurrent publication added another durable row.');
		return { fulfilled: winners.length, rejected: losers.length, winner: winner.candidate, files: 1, rows: count };
	}
	async function adversarial() {
		const input = new LyingBlob('original-video', 'forged-content', { type: 'video/webm' });
		ensure(new TextDecoder().decode(await input.arrayBuffer()) === 'forged-content' && await input.slice().text() === 'forged-content', 'Adversarial readers were not active.');
		const metadata = await store.writeMediaAsset('adversarial-media', input);
		const retained = await actualBody('adversarial-media', 'original-video');
		ensure(metadata.sha256 === ORIGINAL_SHA && retained.sha256 === ORIGINAL_SHA && (await files()).length === 1, 'Stored native digest or inventory differs.');
		return { sha256: metadata.sha256, physicalBytes: 'original-video', overriddenBytes: 'forged-content', files: 1 };
	}
	async function pcmAndDerivatives(kind: 'cascade' | 'trim') {
		const writer = await store.beginSourceWrite('shared-source', { sampleRate: 48_000 });
		try { await writer.write([Float32Array.of(0.5)]); await writer.commit(); } catch (error) { await writer.abort(); throw error; }
		const media = await store.writeMediaAsset('shared-source', new Blob(['container'], { type: 'video/mp4' }));
		const thumbnail = { timestamp: kind === 'cascade' ? 5 : 0, type: 'thumbnail', blob: new Blob(['thumbnail'], { type: 'image/webp' }) };
		const first = await store.saveVideoDerivative('shared-source', thumbnail);
		ensure(media.storage === 'opfs' && first.storage === 'opfs', 'Both immutable and derivative bodies require actual OPFS.');
		ensure((await files()).length === 3, 'PCM/media/derivative native inventory differs.');
		await actualBody('shared-source', 'container');
		if (kind === 'cascade') {
			const selector = { timestamp: 5, type: 'thumbnail' };
			const derivative = await store.loadVideoDerivative('shared-source', selector); ensure(derivative && new TextDecoder().decode(await derivative.arrayBuffer()) === 'thumbnail', 'Native derivative bytes differ.');
			await store.deleteMediaAsset('shared-source'); ensure((await files()).length === 1, 'Media deletion removed PCM or retained a derivative.');
			ensure((await store.getSourceMetadata('shared-source'))?.storage === 'opfs-pcm-v1', 'PCM custody was lost.');
			await store.deleteSource('shared-source'); ensure((await files()).length === 0, 'Source deletion left PCM behind.');
			return { before: 3, afterMediaDelete: 1, afterSourceDelete: 0 };
		}
		const poster = { timestamp: 0, type: 'poster', blob: new Blob(['poster']) };
		await store.saveVideoDerivative('shared-source', poster);
		ensure((await files()).length === 4, 'Both derivative paths were not retained.');
		const report = await store.trimVideoDerivativeCache({ maximumBytes: 0, maximumEntries: 0 });
		ensure(report.removedEntries === 2 && report.removedBytes === 15 && report.satisfied === true && (await files()).length === 2, 'Native derivative trim did not preserve exactly PCM and Original.');
		await actualBody('shared-source', 'container'); ensure((await store.getSourceMetadata('shared-source'))?.frameCount === 1, 'PCM changed during trim.');
		return { before: 4, after: 2, removedEntries: report.removedEntries, removedBytes: report.removedBytes, pcmFrames: 1 };
	}
	async function cancelled() {
		const opfs = store.opfsRepository; ensure(opfs, 'Actual OPFS repository missing.');
		const originalPlan = opfs.planBlobWrite, planWrite = originalPlan.bind(opfs), controller = new AbortController(), reason = new DOMException('cancel staged native media', 'AbortError');
		let writes = 0, stagedFile: File | undefined;
		opfs.planBlobWrite = async (...args: Parameters<typeof planWrite>) => {
			const plan = await planWrite(...args); ensure(plan, 'Actual native plan missing.');
			return Object.freeze<OpfsBlobWritePlan>({ path: plan.path, directory: plan.directory, async write(blob) {
				await plan.write(blob); writes++; stagedFile = await (await plan.directory.getFileHandle(plan.path)).getFile();
				ensure(await stagedFile.text() === 'unpublished', 'Cancellation did not observe real staged bytes.'); controller.abort(reason);
			} });
		};
		try {
			let caught: unknown; try { await store.writeMediaAsset('cancelled-media', new Blob(['unpublished']), {}, { signal: controller.signal }); } catch (error) { caught = error; }
			ensure(caught === reason && writes === 1 && stagedFile instanceof File, 'Native cancellation identity or actual write differed.');
			ensure(await row('cancelled-media') === undefined && (await files()).length === 0, 'Cancelled native write published metadata or left a staged file.');
			return { writes, stagedFile: true, exactReason: true, published: false, files: 0 };
		} finally { opfs.planBlobWrite = originalPlan; }
	}
}
function ensure(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
async function openExisting(name: string): Promise<IDBDatabase> {
	return new Promise((resolve, reject) => { const opening = indexedDB.open(name);
		opening.onsuccess = () => { resolve(opening.result); }; opening.onerror = () => { reject(opening.error); };
		opening.onupgradeneeded = () => { opening.transaction?.abort(); }; });
}
async function removeDatabase(name: string): Promise<void> {
	return new Promise((resolve, reject) => { const removing = indexedDB.deleteDatabase(name); removing.onsuccess = () => { resolve(); };
		removing.onerror = () => { reject(removing.error); }; removing.onblocked = () => { reject(new Error('Actual fixture database is still open.')); }; });
}
