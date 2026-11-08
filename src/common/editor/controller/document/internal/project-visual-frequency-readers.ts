/* SPDX-License-Identifier: AGPL-3.0-only */

import type {
	ProjectVisualClip,
	ProjectVisualProject,
	ProjectVisualServiceDependencies,
	ProjectVisualSource,
} from '../project-visual-types.ts';

/** Cached frequency visuals belong to one project, storage identity and source geometry. */
export function createProjectVisualFrequencyReaders(
	dependencies: Pick<ProjectVisualServiceDependencies, 'sourceFrequencyAnalyses' | 'sourceFrequencyWindows'>,
) {
	return Object.freeze({ sourceFrequencyAnalysis, clipFrequencyWindow });

	function sourceFrequencyAnalysis(
		project: ProjectVisualProject,
		source: ProjectVisualSource | null,
	): unknown {
		if (!source) return null;
		const candidate = dependencies.sourceFrequencyAnalyses?.get(source.id);
		if (!candidate || typeof candidate !== 'object'
			|| !('projectId' in candidate) || candidate.projectId !== project.id
			|| !('storageKey' in candidate) || candidate.storageKey !== (source.storageKey || source.id)
			|| !('analysis' in candidate)) return null;
		const analysis = candidate.analysis;
		if (!analysis || typeof analysis !== 'object') return null;
		if (source.frameCount !== undefined
			&& (!('frameCount' in analysis) || analysis.frameCount !== source.frameCount)) return null;
		if (source.channelCount !== undefined
			&& (!('channelCount' in analysis) || analysis.channelCount !== source.channelCount)) return null;
		if (source.sampleRate !== undefined
			&& (!('sampleRate' in analysis) || analysis.sampleRate !== source.sampleRate)) return null;
		return analysis;
	}

	function clipFrequencyWindow(
		project: ProjectVisualProject,
		clip: ProjectVisualClip,
		source: ProjectVisualSource | null,
	): unknown {
		if (!source) return null;
		const candidate = dependencies.sourceFrequencyWindows?.get(clip.id);
		if (!candidate || typeof candidate !== 'object'
			|| !('projectId' in candidate) || candidate.projectId !== project.id
			|| !('sourceId' in candidate) || candidate.sourceId !== source.id
			|| !('storageKey' in candidate) || candidate.storageKey !== (source.storageKey || source.id)
			|| !('window' in candidate)) return null;
		const window = candidate.window;
		if (!window || typeof window !== 'object') return null;
		if (source.channelCount !== undefined
			&& (!('channelCount' in window) || window.channelCount !== source.channelCount)) return null;
		if (source.sampleRate !== undefined
			&& (!('sampleRate' in window) || window.sampleRate !== source.sampleRate)) return null;
		return window;
	}
}
