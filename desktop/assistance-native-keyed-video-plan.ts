/* SPDX-License-Identifier: AGPL-3.0-only */

import { createDefaultMixerGraphV21 } from '../src/common/editor/mixer-graph-v21.ts';
import { createUnifiedExactRenderPlan } from '../src/common/editor/unified-exact-render-plan.ts';
import type { AssistanceKeyedVideoPlan } from './assistance-keyed-video-contract.ts';

/** Encode already evaluated, claim-authenticated model pixels through the ordinary V14 carrier. */
export function assistanceNativeKeyedPlan(jobId: string, frames: AssistanceKeyedVideoPlan) {
	const sequenceId = 'keyed-output';
	return createUnifiedExactRenderPlan({
		version: 14, strategy: 'framescaper-unified-exact-v1', deliveryProfile: 'encode-webm-vp9-alpha',
		project: { id: jobId, revision: 0 },
		format: { container: 'webm', extension: 'webm', mimeType: 'video/webm' },
		codecs: { video: 'vp9', videoEncoder: 'libvpx-vp9', audio: null, audioEncoder: null, pixelFormat: 'yuva420p' },
		timebase: { sampleStart: 0, sampleDuration: frames.frameCount * frames.frameRate.den,
			sampleRate: frames.frameRate.num, sequenceId, sequenceRate: frames.frameRate },
		output: { frameRate: frames.frameRate, frameCount: frames.frameCount, quality: 'draft',
			canvas: { width: frames.width, height: frames.height, fit: 'contain', pixelFormat: 'yuva420p', backgroundColor: '#00000000' },
			includeAudio: false, audioLayout: null },
		tracks: [], sources: [],
		nodes: [{ kind: 'finishing', nodeId: 'keyed-finishing', sequenceId,
			colorContext: { schemaVersion: 1, sequenceId, workingSpace: 'linear-rec709-d65', outputSpace: 'rec709',
				alphaMode: 'straight-authored-premultiplied-working', toneMapping: 'none' },
			sourceInterpretations: [], visualPresentations: [], processorStacks: [], motionAnalyses: [],
			captionTracks: [], captionDisposition: 'sidecar-only',
			audioContext: { audioTracks: [], masterEffectIds: [], masterChannels: 2, automationLanes: [],
				mixer: createDefaultMixerGraphV21([], 2) } }],
	});
}
