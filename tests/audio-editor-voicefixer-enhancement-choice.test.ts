/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { validateAssistanceWorkflowSettingsV1 } from '../src/common/editor/assistance/workflow-settings-v1.ts';
import { localAssistanceGuidedModelMatches } from '../src/common/editor/controller/assistance/internal/guided/local-assistance-guided-model-selection.ts';
import { assistanceTaskAvailableModelFilter } from '../src/common/editor/controller/assistance/local-assistance-task-models.ts';
import { assistanceRuntimeFamiliesForModel } from '../desktop/assistance-runtime-model-supply.ts';
import { assertAssistanceOnnxEnhancementSeparationModelBindingV1 } from '../desktop/assistance-operation-family-execution.ts';

test('VoiceFixer is an explicit Enhance Dialogue model using the existing ONNX GPU runtime', () => {
	const settings = validateAssistanceWorkflowSettingsV1({ settingsVersion: 1,
		workflowId: 'enhance-dialogue', placement: 'replace-selection', modelId: 'voicefixer' });
	const model = { modelId: 'voicefixer', version: '1.0.0', task: 'speech-enhancement' };
	assert.equal(localAssistanceGuidedModelMatches('enhancer', model, settings), true);
	assert.equal(localAssistanceGuidedModelMatches('enhancer', { ...model, version: '2.0.0' }, settings), false);
	assert.equal(assistanceTaskAvailableModelFilter(settings)(model), true);
	assert.deepEqual(assistanceRuntimeFamiliesForModel(model.modelId, model.task), ['onnxruntime-node']);
	const binding = { slotId: 'enhancer', modelId: model.modelId, version: model.version, artifactSha256s: ['a'.repeat(64)] };
	assert.doesNotThrow(() => assertAssistanceOnnxEnhancementSeparationModelBindingV1('speech-enhancement', binding));
	assert.throws(() => assertAssistanceOnnxEnhancementSeparationModelBindingV1('speech-enhancement', { ...binding, version: '2.0.0' }));
});
