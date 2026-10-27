/* SPDX-License-Identifier: AGPL-3.0-only */
import { assistanceWorkflowModelBindingsSha256V1, assistanceWorkflowRecipeSha256V1, type AssistanceWorkflowV1 } from '../../src/common/editor/assistance/workflow.ts';
import { assistanceWorkflowSettingsSha256V1, defaultAssistanceWorkflowSettingsV1 } from '../../src/common/editor/assistance/workflow-settings-v1.ts';
const JOB_ID = '01'.repeat(20), SOURCE_SHA256 = '12'.repeat(32), LINK_SHA256 = '34'.repeat(32), TIMING_SHA256 = '56'.repeat(32);
export function reframeWorkflow(): AssistanceWorkflowV1 {
	const workflowId = 'reframe';
	const settings = defaultAssistanceWorkflowSettingsV1(workflowId);
	const stageIds = ['detect-subjects', 'detect-saliency', 'track-subjects', 'plan-crops'];
	const models = [
		model('detect-subjects', 'face-detector', 'yunet', '1.0.0', '61'),
		model('detect-subjects', 'object-detector', 'd-fine', '1.0.0', '62'),
		model('detect-saliency', 'saliency-detector', 'u2net-p', '1.0.0', '63'),
	];
	return {
		contractVersion: 1, jobId: JOB_ID, workflowId, recipeVersion: 1,
		settingsVersion: 1, settings, stageIds, models,
		inputs: [
			claim('input', 'detect-subjects', 'frame-pack', 1),
			claim('input', 'detect-saliency', 'frame-pack', 2),
			claim('input', 'track-subjects', 'subject-tracks', 3),
			claim('input', 'plan-crops', 'tracked-subjects', 4),
			claim('input', 'plan-crops', 'saliency-map', 5),
		],
		outputs: [
			claim('output', 'detect-subjects', 'subject-tracks', 6),
			claim('output', 'detect-saliency', 'saliency-map', 7),
			claim('output', 'track-subjects', 'tracked-subjects', 8),
			claim('output', 'plan-crops', 'reframe-path', 9),
		],
		fence: {
			fenceVersion: 1, schemaFamily: 'framescaper', schemaVersion: 1,
			projectId: 'project-a', revision: 8,
			sequenceId: 'sequence-a', transcriptBodySha256: null,
			recipeSha256: assistanceWorkflowRecipeSha256V1(workflowId, 1, stageIds),
			settingsSha256: assistanceWorkflowSettingsSha256V1(settings),
			modelBindingsSha256: assistanceWorkflowModelBindingsSha256V1(models),
			sourceRanges: [{ slotId: 'primary-video', mediaKind: 'video',
				sourceId: 'video-source', sourceSha256: SOURCE_SHA256, sourceSampleRate: null,
				occurrenceIds: ['video-occurrence'], sourceStartFrame: 0, sourceEndFrame: 45,
				linkMembershipSha256: LINK_SHA256, timingAuthoritySha256: TIMING_SHA256,
				retimeKind: 'identity' }],
		},
	};
}

export function reframeResult() {
	const frames = [0, 15, 30, 44].map((sourceFrame) => ({
		sourceFrame, presentationTick: String(sourceFrame),
	}));
	return {
		schemaVersion: 1 as const, kind: 'reframe-path' as const,
		authority: { width: 1_920, height: 1_080, timescale: 1, frames },
		fallbackChain: ['subject', 'saliency', 'center'] as const,
		path: { schemaVersion: 1 as const, targetAspect: { width: 9, height: 16 },
			keyframes: [
				keyframe(0, 'subject', ['subject-1'], 0, 0.68359375),
				keyframe(15, 'saliency', [], 0.68359375, 0),
				keyframe(30, 'center', [], 0.341796875, 0.341796875),
				keyframe(44, 'center', [], 0.1, 0.58359375),
			] },
	};
}

function keyframe(
	sourceFrame: number,
	authority: 'subject' | 'saliency' | 'center',
	trackIds: readonly string[],
	left: number,
	right: number,
) {
	return { sourceFrame, authority, trackIds, crop: { left, top: 0, right, bottom: 0 } };
}

function model(
	stageId: string, slotId: string, modelId: string, version: string, digest: string,
) {
	return { bindingVersion: 1 as const, stageId, slotId, modelId, version,
		artifactSha256s: [digest.repeat(32)] };
}

function claim<const Direction extends 'input' | 'output'>(
	direction: Direction, stageId: string, slotId: string, index: number,
) {
	return { claimVersion: 1 as const, direction,
		claimId: index.toString(16).padStart(40, '0'), jobId: JOB_ID, stageId, slotId };
}
