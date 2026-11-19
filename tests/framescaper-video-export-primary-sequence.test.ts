/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createEditorVideoExportAction } from '../src/common/editor/controller/export/internal/video/video-export-service.ts';
import { createVideoTrack } from '../src/common/editor/project-media-factory.ts';
import { createFramescaperProject } from '../src/framescaper/editor-project.ts';
import { createFramescaperVideoExportStrategyTimelineImage } from '../src/framescaper/video-export-strategy-timeline-image.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE as PROFILE } from '../src/framescaper/editor-project-runtime-profile.ts';
import { framescaperProjectTimelineImageFoundationShapeAssistance } from '../src/framescaper/editor-project-assistance-foundation.ts';
import { framescaperBaselineOptions } from './helpers/framescaper-baseline-model-fixture.ts';

type RecordData = Record<string, unknown>;

function exportProjectWithSecondaryTrack({ solo = false, hasClip = false } = {}) {
	const options = framescaperBaselineOptions();
	(options.sequences as RecordData[]).push({ id: 'unused-sequence', rate: { num: 10, den: 1 }, trackIds: ['unused-video'] });
	(options.tracks as RecordData[]).push(createVideoTrack({
		id: 'unused-video', name: 'Unused footage', clipIds: hasClip ? ['unused-clip'] : [], solo,
	}));
	if (hasClip) {
		const clips = options.clips as RecordData[];
		clips.push({ ...clips[0], id: 'unused-clip', sequenceId: 'unused-sequence', sequenceStartFrame: 6 });
	}
	const project = createFramescaperProject(PROFILE, options);
	const canonicalProject = framescaperProjectTimelineImageFoundationShapeAssistance(project);
	const strategy = createFramescaperVideoExportStrategyTimelineImage(PROFILE);
	const exportProject = strategy.createExportProject({ canonicalProject, delivery: {
		project: canonicalProject, audioRenderedFallback: null, videoRenderedFallback: null,
		requiredAudioSourceIds: [], requiredVideoSourceIds: [],
	} });
	return { strategy, canonicalProject, exportProject };
}

test('File > Export Video keeps the primary video when an empty track in an unused sequence is soloed', () => {
	const { strategy, canonicalProject, exportProject } = exportProjectWithSecondaryTrack({ solo: true });
	const plan = strategy.createPlan({ canonicalProject, exportProject, format: 'webm', range: 'project', includeAudio: false, canvas: undefined });
	assert.deepEqual(plan?.activeClipIds, ['video-clip']);
});

test('File > Export Video checks the primary programme for picture and source readiness', async () => {
	for (const options of [{ solo: true }, { hasClip: true }]) {
		const { strategy, canonicalProject } = exportProjectWithSecondaryTrack(options);
		const reachedSourceReadiness = new Error('Source readiness reached');
		const runExport = createEditorVideoExportAction({
			state: { exportAbort: null, exportGeneration: 0, disposed: false },
			getProject: () => canonicalProject,
			findClip: (project: { clips: readonly RecordData[] }, id: string) => project.clips.find(clip => clip.id === id),
			hasMissingTimelineSources(project: { clips: readonly RecordData[] }) {
				assert.deepEqual(project.clips.map(({ id }) => id), ['video-clip']);
				throw reachedSourceReadiness;
			},
			options: { productVideoExportStrategy: strategy },
		} as never, async () => assert.fail('This regression stops before rendering.'));
		await assert.rejects(runExport({ format: 'video-webm', includeAudio: false }), error => error === reachedSourceReadiness);
	}
});

test('File > Export Video leaves overlapping footage from an unused sequence out of the primary programme', () => {
	const { strategy, canonicalProject, exportProject } = exportProjectWithSecondaryTrack({ hasClip: true });
	const plan = strategy.createPlan({ canonicalProject, exportProject, format: 'webm', range: 'project', includeAudio: false, canvas: undefined });
	assert.deepEqual(plan?.activeClipIds, ['video-clip']);
	assert.deepEqual(plan?.range, { startFrame: 0, endFrame: 48_000, durationFrames: 48_000 });
});
