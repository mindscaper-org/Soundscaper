/* SPDX-License-Identifier: AGPL-3.0-only */

import { bindVideoSourceTimingView, videoSourceFrameTime } from '../common/editor/video-source-timing-view.ts';
import { resolveVideoSourceTimingViews } from '../common/editor/video-source-timing-views.ts';
import { createDefaultMixerGraphV21 } from '../common/editor/mixer-graph-v21.ts';
import { nativeMediaV14EncodeDispatch } from '../common/editor/native-media-v14-native-dispatch.ts';
import { createFramescaperUnifiedRenderFoundation, finalizeFramescaperUnifiedRenderPlan } from './editor-project-unified-render-core.ts';
import { createFramescaperUnifiedProfessionalRenderNodes } from './editor-project-unified-render-professional.ts';
import { createFramescaperUnifiedRenderFinishingNodeNativeMedia } from './editor-project-unified-render-plan-native-media.ts';
import type { FramescaperProjectNativeMedia } from './editor-project-native-media.ts';

/** A proxy job binds one whole original; it has no timeline clip occurrence or picture effects. */
export function createFramescaperNativeProxySourcePlan(project: FramescaperProjectNativeMedia, sourceId: string) {
	const source = (project.sources as readonly Readonly<Record<string, unknown>>[]).find(candidate => candidate.id === sourceId);
	if (!source || source.kind !== 'video' || source.imageSequence !== null) throw new Error('Native proxy generation requires one ordinary original video source.');
	const views = resolveVideoSourceTimingViews(project);
	const timing = bindVideoSourceTimingView(views, source);
	const end = videoSourceFrameTime(timing, { numerator: BigInt(timing.frameCount), denominator: 1n });
	const samples = end.numerator * BigInt(Number(project.sampleRate));
	const sampleDuration = Number((samples + end.denominator - 1n) / end.denominator);
	if (!Number.isSafeInteger(sampleDuration) || sampleDuration < 1) throw new RangeError('The native proxy source duration exceeds its exact sample domain.');
	const dispatch = nativeMediaV14EncodeDispatch('encode-mov-prores-proxy');
	const sequenceId = String(project.primarySequenceId);
	// This is a job projection of the admitted project, never an authored edit.
	// Empty placements avoid inventing a visible occurrence for a bin-only source.
	const projection = { ...project, sources: [source], clips: [], tracks: [],
		sequences: (project.sequences as readonly Readonly<Record<string, unknown>>[]).map(sequence => ({ ...sequence, trackIds: [] })) };
	const foundation = createFramescaperUnifiedRenderFoundation(projection, {
		sequenceId, sampleStart: 0, sampleDuration, outputRate: source.frameRate as { num: number; den: number },
		format: { container: 'mov', extension: 'mov', mimeType: 'video/quicktime' },
		codecs: { video: 'prores', videoEncoder: dispatch.encoder, pixelFormat: dispatch.pixelFormat, audio: null, audioEncoder: null },
		canvas: { width: 1920, height: 1080, fit: 'contain', pixelFormat: dispatch.pixelFormat, backgroundColor: '#000000' },
		quality: 'balanced', includeAudio: false, audioLayout: null, timingViews: new Map([[sourceId, views.get(sourceId)!]]),
	}, 14);
	const finishing = createFramescaperUnifiedRenderFinishingNodeNativeMedia(project, foundation.projectIdentities, sequenceId);
	return finalizeFramescaperUnifiedRenderPlan(foundation, 14, [...createFramescaperUnifiedProfessionalRenderNodes(foundation), {
		...finishing, sourceInterpretations: finishing.sourceInterpretations.filter(interpretation => interpretation.sourceId === sourceId),
		visualPresentations: [], processorStacks: [], motionAnalyses: [], captionTracks: [],
		audioContext: { ...finishing.audioContext, audioTracks: [], masterEffectIds: [], automationLanes: [], mixer: createDefaultMixerGraphV21([], Number(project.masterChannels)) },
	}], 'encode-mov-prores-proxy');
}
