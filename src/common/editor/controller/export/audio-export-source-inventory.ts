/* SPDX-License-Identifier: AGPL-3.0-only */

import { clipNeedsTimePitchRender } from '../../clip-time-pitch-cache-plan.js';
import { clipTimePitchPlaybackProjection } from '../../clip-time-pitch-playback-projection.ts';
import { resolveExportRange } from '../../export.js';
import { projectForRuntimeConsumers } from '../../project-current-runtime.ts';
import type { RuntimeClipProject } from '../../runtime-clip-projection.ts';
import type { EditorExportSettings } from './export-settings.ts';

interface SourceInventoryProject extends RuntimeClipProject {
	readonly sources?: readonly Readonly<{ id: unknown; sampleRate?: unknown }>[];
}

/**
 * Inputs beginning at or after the delivered endpoint cannot enter its mix or
 * effect tail. Keep all earlier inputs for pre-roll, latency and sidechains.
 * Scalar cache preparation still visits the full project, so retain those
 * dependencies even outside the range. Mastering orders own separate spans.
 */
export function audioExportSourceInventory<Project extends SourceInventoryProject>(
	project: Project,
	settings: Pick<EditorExportSettings, 'range' | 'masteringSequenceId'>,
): Project {
	if (settings.range == null || settings.range === 'project' || settings.masteringSequenceId) return project;
	const resolved = projectForRuntimeConsumers(project);
	const { endFrame } = resolveExportRange(resolved, settings.range);
	const sources = new Map((project.sources ?? []).map(source => [source.id, source]));
	const neededIds = new Set(resolved.clips.filter(clip => {
		if (clip.timelineStartFrame < endFrame) return true;
		const source = sources.get(clip.sourceId);
		return !source || Boolean(clipNeedsTimePitchRender(clipTimePitchPlaybackProjection(resolved, clip, source)));
	}).map(clip => clip.id));
	return { ...project, clips: project.clips?.filter(clip => neededIds.has(clip.id)) };
}
