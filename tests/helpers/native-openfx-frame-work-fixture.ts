/* SPDX-License-Identifier: AGPL-3.0-only */

import { createFramescaperProjectUnifiedExactRenderPlanFinishing } from '../../src/framescaper/editor-project-unified-render-plan-finishing.ts';
import { framescaperNativeRenderCarrierProjectNativeMedia } from '../../src/framescaper/editor-native-render-carrier-project.ts';
import { FRAMESCAPER_FINISHING_PROJECT_RUNTIME_PROFILE as FOUNDATION_PROFILE } from '../../src/framescaper/editor-domain-runtime-profile.ts';
import { createFramescaperProjectNativeMedia } from '../../src/framescaper/editor-project-native-media.ts';
import { FRAMESCAPER_NATIVE_MEDIA_PROJECT_RUNTIME_PROFILE as PROFILE } from '../../src/framescaper/editor-domain-runtime-profile.ts';
import { createFramescaperNativeRenderPlanAuthorityNativeMedia } from '../../src/framescaper/editor-native-render-plan-authority.ts';
import { createFramescaperProjectUnifiedExactRenderPlanNativeMedia } from '../../src/framescaper/editor-project-unified-render-plan-native-media.ts';
import { createUnifiedExactRenderPlan, type UnifiedExactRenderPlanV14 } from '../../src/common/editor/unified-exact-render-plan.ts';
import { framescaperV20Options } from './framescaper-model-fixture.ts';

function projectFixture(clipCount: number) {
	const options = framescaperV20Options();
	const base = (options.clips as Record<string, unknown>[]).find(clip => clip.kind === 'video')!;
	const clips = Array.from({ length: clipCount }, (_, index) => ({ ...base, id: index === 0 ? 'video-clip' : `video-clip-${String(index)}`, sequenceStartFrame: index * Number(base.sequenceFrameCount) }));
	options.clips = [...clips, ...(options.clips as Record<string, unknown>[]).filter(clip => clip.kind !== 'video')];
	(options.tracks as Record<string, unknown>[]).find(track => track.type === 'video')!.clipIds = clips.map(clip => clip.id);
	options.ofxEffects = clips.map((clip, index) => ({ schemaVersion: 1, instanceId: index === 0 ? 'effect-filter' : `effect-filter-${String(index)}`, pluginId: 'net.example.Filter', binarySha256: 'a7'.repeat(32),
		context: 'filter', attachment: { kind: 'filter', targetId: clip.id }, inputs: [{ name: 'Source', sourceRef: 'video-source' }],
		parameters: [], customEncodings: {}, enabled: true, freshness: { authoredStateSha256: 'a7'.repeat(32), inputIdentitiesSha256: 'a7'.repeat(32),
			renderPlanFingerprintSha256: 'a7'.repeat(32), nativeEffectFingerprintSha256: 'a7'.repeat(32) }, frozenFallback: null }));
	return createFramescaperProjectNativeMedia(PROFILE, options);
}

function planFor(project: ReturnType<typeof projectFixture>) {
	const plan = createFramescaperProjectUnifiedExactRenderPlanNativeMedia(PROFILE, project, createFramescaperNativeRenderPlanAuthorityNativeMedia(project));
	return createUnifiedExactRenderPlan({ ...plan, output: { ...plan.output, canvas: { ...plan.output.canvas, width: 2, height: 2 } } }) as UnifiedExactRenderPlanV14;
}


export function nativeOpenFxFrameWorkFixture(): UnifiedExactRenderPlanV14 { return planFor(projectFixture(1)); }

export function nativeOpenFxExactPlaneWorkFixture(clipCount: number) {
	const project = projectFixture(clipCount); const plan = planFor(project);
	const authority = createFramescaperNativeRenderPlanAuthorityNativeMedia(project);
	const foundation = createFramescaperProjectUnifiedExactRenderPlanFinishing(FOUNDATION_PROFILE, framescaperNativeRenderCarrierProjectNativeMedia(project), {
		...authority, format: { container: 'mp4', extension: 'mp4', mimeType: 'video/mp4' },
		codecs: { video: 'h264', videoEncoder: 'libx264', audio: null, audioEncoder: null, pixelFormat: 'yuv420p' },
		canvas: { ...plan.output.canvas, pixelFormat: 'yuv420p' }, includeAudio: false, audioLayout: null,
	});
	return { plan, foundation };
}
