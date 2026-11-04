/* SPDX-License-Identifier: AGPL-3.0-only */

import type { LocalAssistanceModel } from '../assistance/local-assistance-bridge.ts';
import type { AssistanceOperation } from '../assistance/operation.ts';
import type { AssistanceGuidedWorkflowId } from '../assistance/workflow-recipes.ts';
import { defaultAssistanceWorkflowSettingsV1,
	type AssistanceWorkflowSettingsV1 } from '../assistance/workflow-settings-v1.ts';
import { assistanceTaskModelFilter } from '../controller/assistance/local-assistance-task-models.ts';

type Model = Pick<LocalAssistanceModel, 'modelId' | 'version' | 'task'>;
type Copy = Readonly<Record<string, string | undefined>>;
type Recognizer = 'parakeet' | 'whisper';

export function assistanceTaskRecognizerChoices(models: readonly Model[]): readonly Readonly<{
	recognizer: Recognizer; modelId: string;
}>[] {
	const settings = defaultAssistanceWorkflowSettingsV1('transcribe-captions');
	if (settings.workflowId !== 'transcribe-captions') return [];
	return (['parakeet', 'whisper'] as const).flatMap((recognizer) => {
		const filter = assistanceTaskModelFilter({ ...settings, recognizer });
		const model = models.find((candidate) => candidate.task === 'speech-recognition' && filter(candidate));
		return model ? [{ recognizer, modelId: model.modelId }] : [];
	});
}

/** A hidden single-model picker must still select that installed recognizer. */
export function assistanceTaskSettingsForModels(
	settings: AssistanceWorkflowSettingsV1, models: readonly Model[],
): AssistanceWorkflowSettingsV1 {
	if (settings.workflowId !== 'transcribe-captions') return settings;
	const choices = assistanceTaskRecognizerChoices(models);
	return choices.length === 1 && settings.recognizer !== choices[0]!.recognizer
		? { ...settings, recognizer: choices[0]!.recognizer } : settings;
}

export function assistanceTaskHasControls(settings: AssistanceWorkflowSettingsV1, models: readonly Model[]): boolean {
	if (settings.workflowId === 'transcribe-captions' && assistanceTaskRecognizerChoices(models).length > 1) return true;
	return !['enhance-dialogue', 'reduce-reverb', 'separate-dialogue-music-effects',
		'identify-speakers', 'index-transcript'].includes(settings.workflowId)
		&& !settings.workflowId.startsWith('advanced:');
}

export function assistanceTaskActionLabel(workflowId: AssistanceGuidedWorkflowId, copy: Copy): string {
	if (workflowId === 'generate-editorial-text') return copy.generate || 'Generate';
	if (['enhance-dialogue', 'reduce-reverb', 'separate-dialogue-music-effects',
		'clean-filler-silence', 'reframe', 'make-highlights'].includes(workflowId)) return copy.apply || 'Apply';
	return copy.analyze || 'Analyze';
}

export function assistanceOperationActionLabel(operation: AssistanceOperation | null, copy: Copy): string {
	if (operation === 'text-to-speech' || operation === 'editorial-generation') return copy.generate || 'Generate';
	if (operation && ['speech-enhancement', 'dereverberation', 'source-separation', 'video-keying'].includes(operation)) {
		return copy.apply || 'Apply';
	}
	return copy.analyze || 'Analyze';
}
