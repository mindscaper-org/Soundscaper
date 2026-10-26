/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { visualProjectOptions } from './helpers/framescaper-unified-render-project-fixture.ts';
import { createFramescaperProjectNativeMedia } from '../src/framescaper/editor-project-native-media.ts';
import { FRAMESCAPER_NATIVE_MEDIA_PROJECT_RUNTIME_PROFILE, FRAMESCAPER_FINISHING_PROJECT_RUNTIME_PROFILE } from '../src/framescaper/editor-domain-runtime-profile.ts';
import { createFramescaperNativeRenderPlanAuthorityNativeMedia } from '../src/framescaper/editor-native-render-plan-authority.ts';
import { createFramescaperProjectUnifiedExactRenderPlanNativeMedia } from '../src/framescaper/editor-project-unified-render-plan-native-media.ts';
import { framescaperNativeRenderCarrierProjectNativeMedia } from '../src/framescaper/editor-native-render-carrier-project.ts';
import { createFramescaperVideoExportStrategyFinishing } from '../src/framescaper/video-export-strategy-finishing.ts';
import { assertFramescaperNativeCarrierPlanParityNativeMedia, framescaperNativeCarrierPlanningRateNativeMedia } from '../src/framescaper/editor-native-render-carrier-semantics.ts';
import { isFramescaperVideoVisualPlanFinishing } from '../src/framescaper/video-export-visual-plan-finishing.ts';

test('a generator-only native delivery accepts its actual raw visual carrier plan', () => {
	const options = visualProjectOptions();
	const generator = ((options.visualModel as { generatorSources: Record<string, unknown>[] }).generatorSources[0])!;
	options.sources = [];
	options.visualModel = { generatorSources: [{ ...generator, width: 2, height: 2, generator: { kind: 'solid', color: '#ff0000ff' } }] };
	options.clips = [{ schemaVersion: 1, kind: 'generator', id: 'solid', sourceId: generator.id, sequenceId: 'main-sequence', sequenceStartFrame: 0, sequenceFrameCount: 1, sourceInFrame: 0, sourceFrameCount: 1 }];
	options.projectBin = { clips: [] };
	options.tracks = [{ id: 'video-track', type: 'video', name: 'Video', clipIds: ['solid'] }];
	options.sequences = [{ id: 'main-sequence', rate: { num: 30, den: 1 }, trackIds: ['video-track'] }];
	options.videoTransitionsByTrackId = {};
	const project = createFramescaperProjectNativeMedia(FRAMESCAPER_NATIVE_MEDIA_PROJECT_RUNTIME_PROFILE, options);
	const v14 = createFramescaperProjectUnifiedExactRenderPlanNativeMedia(FRAMESCAPER_NATIVE_MEDIA_PROJECT_RUNTIME_PROFILE, project, createFramescaperNativeRenderPlanAuthorityNativeMedia(project));
	const inherited = framescaperNativeRenderCarrierProjectNativeMedia(project);
	const strategy = createFramescaperVideoExportStrategyFinishing(FRAMESCAPER_FINISHING_PROJECT_RUNTIME_PROFILE);
	const exportProject = strategy.createExportProject({ canonicalProject: inherited, delivery: { project: inherited, audioRenderedFallback: null, videoRenderedFallback: null, requiredAudioSourceIds: [], requiredVideoSourceIds: [] } });
	const plan = strategy.createPlan({ canonicalProject: inherited, exportProject, format: 'mp4', range: 'project', includeAudio: false,
		canvas: { size: { width: v14.output.canvas.width, height: v14.output.canvas.height }, frameRate: framescaperNativeCarrierPlanningRateNativeMedia(v14.output.frameRate), fit: v14.output.canvas.fit, backgroundColor: v14.output.canvas.backgroundColor }, quality: v14.output.quality });
	assert.ok(plan && isFramescaperVideoVisualPlanFinishing(plan));
	assert.equal(plan.codecs, undefined);
	assert.doesNotThrow(() => { assertFramescaperNativeCarrierPlanParityNativeMedia(v14, plan); });
});
