/* SPDX-License-Identifier: AGPL-3.0-only */

import { createAup4Client } from '../../aup4-client.js';
import type { AudacityRecoveryInspection } from '../../audacity-recovery-inspection.ts';

interface Descriptor { readonly id: string; readonly name: string }
export interface AudacityRecoveryFiles {
	readonly isDesktop: boolean;
	chooseFiles(request: { purpose: string; multiple: boolean }): Promise<readonly Descriptor[]>;
	withReadDescriptors<T>(descriptors: readonly Descriptor[], options: { retainReads: boolean; signal: AbortSignal }, consume: (files: readonly File[]) => Promise<T>): Promise<T>;
	releaseRead(id: string): Promise<unknown>;
	chooseSaveTarget(request: { purpose: string; suggestedName: string }): Promise<unknown>;
	saveFile(request: { purpose: string; target: unknown; suggestedName: string; bytes: Uint8Array; mimeType: string; signal: AbortSignal }): Promise<unknown>;
	releaseSaveTarget(target: unknown): unknown;
}
interface Client {
	openFile(id: string, file: File, options: { recover: boolean; signal: AbortSignal }): Promise<unknown>;
	call(type: string, args: { projectId: string }, options: { signal?: AbortSignal }): Promise<unknown>;
	dispose(): void;
}

/** Own the selected capability across preview and the user's chosen recovery action. */
export function createAudacityRecoverySelection(files: AudacityRecoveryFiles, clientFactory: () => Client = createAup4Client) {
	let selection: File | Descriptor | null = null, disposed = false;
	const cancellation = new AbortController();
	const projectId = `recovery-${crypto.randomUUID()}`;
	const assertActive = (): void => { cancellation.signal.throwIfAborted(); };
	const release = async (): Promise<void> => {
		const previous = selection; selection = null;
		if (previous && !(previous instanceof Blob)) await files.releaseRead(previous.id);
	};
	async function withFile<T>(consume: (file: File) => Promise<T>): Promise<T> {
		assertActive();
		if (!selection) throw new Error('Choose an Audacity project first.');
		if (selection instanceof Blob) return consume(selection as File);
		return files.withReadDescriptors([selection], { retainReads: true, signal: cancellation.signal }, async selected => {
			assertActive();
			if (selected.length !== 1) throw new Error('Choose one Audacity project.');
			return consume(selected[0]!);
		});
	}
	async function withClient<T>(consume: (client: Client) => Promise<T>): Promise<T> {
		return withFile(async file => {
			const client = clientFactory();
			let opened = false;
			try {
				await client.openFile(projectId, file, { recover: true, signal: cancellation.signal });
				opened = true;
				assertActive();
				return await consume(client);
			} finally {
				try { if (opened) await client.call('delete', { projectId }, {}); }
				finally { client.dispose(); }
			}
		});
	}
	return {
		async choose(): Promise<string | null> {
			assertActive();
			const descriptors = await files.chooseFiles({ purpose: 'project', multiple: false });
			if (disposed || descriptors.length !== 1 || !/\.aup(?:[34]|4unsaved)$/iu.test(descriptors[0]!.name)) {
				await Promise.all(descriptors.map(async descriptor => files.releaseRead(descriptor.id)));
				assertActive();
				if (descriptors.length) throw new TypeError('Choose an Audacity project (.aup3, .aup4 or .aup4unsaved).');
				return null;
			}
			await release(); selection = descriptors[0]!; return selection.name;
		},
		async setFile(file: File): Promise<string> {
			assertActive(); await release(); assertActive(); selection = file; return file.name;
		},
		async inspect(): Promise<AudacityRecoveryInspection> {
			return withClient(async client => await client.call('inspect-recovery', { projectId }, { signal: cancellation.signal }) as AudacityRecoveryInspection);
		},
		async recover(open: (file: File, options: { recover: true }) => unknown): Promise<void> {
			await withFile(async file => { await open(file, { recover: true }); });
		},
		async saveCopy(): Promise<boolean> {
			assertActive();
			if (!selection) throw new Error('Choose an Audacity project first.');
			const extension = /\.aup3$/iu.test(selection.name) ? '.aup3' : '.aup4';
			const suggestedName = selection.name.replace(/\.aup(?:[34]|4unsaved)$/iu, '') + ' (Recovered)' + extension;
			const purpose = 'audacity-recovery';
			const target = await files.chooseSaveTarget({ purpose, suggestedName });
			if (!target) return false;
			try {
				assertActive();
				return await withClient(async client => {
					const result = await client.call('repair-native-copy', { projectId }, { signal: cancellation.signal }) as { bytes: Uint8Array; mimeType: string };
					assertActive();
					await files.saveFile({ purpose, target, suggestedName, ...result, signal: cancellation.signal }); return true;
				});
			} finally { await files.releaseSaveTarget(target); }
		},
		async dispose(): Promise<void> {
			if (disposed) return;
			disposed = true; cancellation.abort(); await release();
		},
	};
}
