/* SPDX-License-Identifier: AGPL-3.0-only */

import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { withDesktopAssistanceBuildWork } from './desktop-assistance-build-process.mjs';

export interface VulkanToolchainRequest {
	readonly targetId: string;
	readonly cacheRoot: string;
	readonly work: string;
	readonly platform: NodeJS.Platform;
	readonly architecture: NodeJS.Architecture;
}

/** Own one pinned toolchain until all engine consumers finish; never reuse it across invocations. */
export async function withSharedDesktopVulkanToolchain<T, R>(
	stage: (prepare: (request: VulkanToolchainRequest) => Promise<R>) => Promise<T>,
	{ prepare }: { prepare: (request: VulkanToolchainRequest) => Promise<R> },
): Promise<T> {
	// Keep MSBuild's deep source paths short, independently of either engine's cleanup.
	const work = await mkdtemp(join(tmpdir(), 'sc-vulkan-'));
	return withDesktopAssistanceBuildWork(work, async () => {
		let identity: string | undefined;
		let pending: Promise<R> | undefined;
		const shared = (request: VulkanToolchainRequest): Promise<R> => {
			const key = JSON.stringify([request.targetId, request.cacheRoot, request.platform, request.architecture]);
			if (identity !== undefined && identity !== key) {
				return Promise.reject(new Error('Shared Vulkan toolchain identity differs from its first consumer.'));
			}
			identity = key;
			pending ??= Promise.resolve().then(() => prepare({ ...request, work }));
			return pending;
		};
		try {
			const result = await stage(shared);
			await pending;
			return result;
		} catch (error) {
			// Join any started compiler before releasing the shared work directory.
			await pending?.catch(() => undefined);
			throw error;
		}
	});
}
