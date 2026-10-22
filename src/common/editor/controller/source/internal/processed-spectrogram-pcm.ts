/* SPDX-License-Identifier: AGPL-3.0-only */

import { clipNeedsTimePitchRender } from '../../../clip-time-pitch-cache.js';
import type { PrepareSpectrogramProcessedPcm, SpectrogramProcessedPcm } from '../../../spectrogram-processed-pcm-contract.ts';
import type { ProjectVisualClip, ProjectVisualProject, ProjectVisualSource } from '../../document/project-visual-types.ts';
import type { ClipTimePitchCacheEntry, ClipTimePitchCachePort } from '../clip-time-pitch-service.ts';

export interface ProcessedSpectrogramDependencies {
	getProject(): ProjectVisualProject | null;
	captureAuthority(projectId: string): () => void;
	readonly cache: Pick<ClipTimePitchCachePort, 'prepareCommittedOutput'>;
	open(entry: ClipTimePitchCacheEntry): SpectrogramProcessedPcm;
}

/** Request the exact committed transform without materializing an AudioBuffer. */
export function processedSpectrogramPreparation(
	dependencies: ProcessedSpectrogramDependencies,
	project: ProjectVisualProject,
	clip: ProjectVisualClip,
	source: ProjectVisualSource,
): PrepareSpectrogramProcessedPcm | undefined {
	if (clip.warpMap != null || !clipNeedsTimePitchRender(clip)) return undefined;
	return async signal => {
		const assertAuthority = dependencies.captureAuthority(project.id);
		const assertCurrent = (): void => {
			signal.throwIfAborted();
			assertAuthority();
			if (dependencies.getProject() !== project) throw new DOMException('The spectral recording changed.', 'AbortError');
		};
		assertCurrent();
		const entry = await dependencies.cache.prepareCommittedOutput(clip, source, { signal });
		assertCurrent();
		const pcm = dependencies.open(entry);
		return Object.freeze({
			frameCount: pcm.frameCount,
			async readWindow(start: number, end: number, readSignal: AbortSignal) {
				assertCurrent(); readSignal.throwIfAborted();
				const window = await pcm.readWindow(start, end, readSignal);
				assertCurrent(); readSignal.throwIfAborted(); return window;
			},
			dispose: () => pcm.dispose(),
		});
	};
}
