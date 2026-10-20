/* SPDX-License-Identifier: AGPL-3.0-only */
import { createAup4Client } from '../../../aup4-client.js';
import { WavPackCodecClient } from '../../../wavpack/client.js';
import { nativeCloudHash, tagNativeCloudBlock } from '../../../audiocom-native-project.ts';
import type { AudiocomProjectArchive } from '../audiocom-project-archives.ts';

interface Transport {
	request(path: string, init?: RequestInit): Promise<Response>;
	data(response: Response): Promise<unknown>;
}
interface Manifest { metadata: Uint8Array<ArrayBuffer>; blocks: readonly { id: number; size: number }[] }
const record = (value: unknown): Record<string, unknown> => {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid native project response.');
	return value as Record<string, unknown>;
};
const ID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/iu;

/** Keep decoded audio bounded to one block; encode in the existing codec worker. */
export async function uploadNativeCloudProject(transport: Transport, file: File, name: string, signal?: AbortSignal, revision?: AudiocomProjectArchive): Promise<unknown> {
	const archive = createAup4Client();
	const codec = new WavPackCodecClient();
	const localId = `cloud-${crypto.randomUUID()}`;
	try {
		await archive.call('open-file', { projectId: localId, file, transient: true }, { signal });
		const manifest = await archive.call('cloud-manifest', { projectId: localId }, { signal }) as Manifest;
		if (manifest.blocks.length > 1000 || manifest.metadata.length > 100000000) throw new Error('The native cloud project exceeds the transfer limit.');
		const blocks = new Map<string, { id: number; size: number }>();
		for (const block of manifest.blocks) {
			const pcm = await archive.call('cloud-block', { projectId: localId, blockId: block.id }, { signal }) as Uint8Array<ArrayBuffer>;
			blocks.set((await nativeCloudHash(block.id, pcm)).toLowerCase(), block);
		}
		signal?.throwIfAborted();
		const prepared = record(await transport.data(await transport.request('projects?phase=prepare', {
			method: 'POST', signal: AbortSignal.timeout(10000), headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ name, blocks: [...blocks.keys()].map(hash => hash.toUpperCase()), ...(revision ? { id: revision.id, head: revision.snapshotId } : {}) }),
		})));
		if (typeof prepared.projectId !== 'string' || !ID.test(prepared.projectId) && !/^[1-9]\d{0,15}$/u.test(prepared.projectId) || typeof prepared.snapshotId !== 'string' || !ID.test(prepared.snapshotId)
			|| revision && prepared.projectId !== revision.id || !Array.isArray(prepared.missing)
			|| prepared.missing.some((hash: unknown) => typeof hash !== 'string' || !blocks.has(hash.toLowerCase()))) throw new Error('Invalid prepared native project.');
		const query = new URLSearchParams({ project: prepared.projectId, snapshot: prepared.snapshotId });
		let cleanup: Promise<void> | undefined;
		const cancel = (): Promise<void> => cleanup ??= transport.request(`projects?${query}`, {
			method: 'DELETE', signal: AbortSignal.timeout(10000),
		}).then(async response => { await response.body?.cancel(); }).catch(() => undefined);
		const aborted = (): void => { void cancel(); };
		signal?.addEventListener('abort', aborted, { once: true });
		try {
			const part = async (bytes: Uint8Array<ArrayBuffer>, hash?: string): Promise<void> => {
				signal?.throwIfAborted();
				const params = new URLSearchParams(query); params.set('phase', 'part'); if (hash) params.set('hash', hash);
				const response = await transport.request(`projects?${params}`, { method: 'POST', signal, body: new Blob([bytes]),
					headers: { 'Content-Type': 'application/octet-stream', 'X-Audiocom-Filename': hash ? 'block.wv' : 'snapshot.xml', 'X-Audiocom-Content-Length': String(bytes.length) } });
				if (!response.ok) await transport.data(response); else await response.body?.cancel();
			};
			await part(manifest.metadata);
			for (const value of prepared.missing as string[]) {
				const hash = value.toLowerCase(), block = blocks.get(hash)!;
				const pcm = await archive.call('cloud-block', { projectId: localId, blockId: block.id }, { signal }) as Uint8Array<ArrayBuffer>;
				const encoded = await codec.encode(pcm.buffer, { frames: block.size / 4, channelCount: 1, sampleRate: 48000, requireWavPack: true, signal }) as { payload: ArrayBuffer };
				await part(tagNativeCloudBlock(new Uint8Array(encoded.payload), block.id, hash.toUpperCase()), hash);
			}
			const completing = new URLSearchParams(query); completing.set('phase', 'complete');
			return await transport.data(await transport.request(`projects?${completing}`, { method: 'POST', signal }));
		} catch (error) { await cancel(); throw error; }
		finally { signal?.removeEventListener('abort', aborted); }
	} finally {
		codec.close();
		try { await archive.call('delete', { projectId: localId }, { timeoutMs: 5000 }); } catch { /* The worker may already be unavailable after cancellation. */ }
		archive.dispose();
	}
}
