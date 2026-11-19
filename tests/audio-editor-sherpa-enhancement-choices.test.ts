/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { validateAssistanceWorkflowSettingsV1 } from '../src/common/editor/assistance/workflow-settings-v1.ts';
import { localAssistanceGuidedModelMatches } from '../src/common/editor/controller/assistance/internal/guided/local-assistance-guided-model-selection.ts';
import { assistanceTaskAvailableModelFilter } from '../src/common/editor/controller/assistance/local-assistance-task-models.ts';
import { assistanceRuntimeFamiliesForModel } from '../desktop/assistance-runtime-model-supply.ts';

for (const [modelId, version] of [['gtcrn', '1.0.0'], ['dpdfnet2-48khz', '1.0.0'], ['voxlock', '1.1.1']] as const) {
	test(`Enhance Dialogue selects ${modelId} explicitly and installs Sherpa`, () => {
		const settings = validateAssistanceWorkflowSettingsV1({ settingsVersion: 1,
			workflowId: 'enhance-dialogue', placement: 'replace-selection', modelId });
		const model = { modelId, version, task: 'speech-enhancement' };
		assert.equal(localAssistanceGuidedModelMatches('enhancer', model, settings), true);
		assert.equal(localAssistanceGuidedModelMatches('enhancer', { ...model, version: 'wrong' }, settings), false);
		assert.equal(localAssistanceGuidedModelMatches('enhancer', { modelId: 'deepfilternet3', version: '3.0.0', task: model.task }, settings), false);
		assert.equal(assistanceTaskAvailableModelFilter(settings)(model), true);
		assert.deepEqual(assistanceRuntimeFamiliesForModel(modelId, model.task), ['sherpa-onnx-node']);
	});
}

test('existing enhancement settings retain DeepFilterNet3 and reject unknown models', () => {
	const legacy = validateAssistanceWorkflowSettingsV1({ settingsVersion: 1,
		workflowId: 'enhance-dialogue', placement: 'replace-selection' });
	assert.equal(localAssistanceGuidedModelMatches('enhancer', { modelId: 'deepfilternet3',
		version: '3.0.0', task: 'speech-enhancement' }, legacy), true);
	assert.throws(() => validateAssistanceWorkflowSettingsV1({ ...legacy, modelId: 'arbitrary' }), /model/iu);
});

test('installed enhancement alternatives expose controls and a sole alternative is executable', async () => {
	const { assistanceTaskHasControls, assistanceTaskSettingsForModels } = await import('../src/common/editor/ui/local-assistance-task-controls.ts');
	const settings = validateAssistanceWorkflowSettingsV1({ settingsVersion: 1, workflowId: 'enhance-dialogue', placement: 'replace-selection' });
	const voxlock = { modelId: 'voxlock', version: '1.1.1', task: 'speech-enhancement' };
	const deepfilter = { modelId: 'deepfilternet3', version: '3.0.0', task: 'speech-enhancement' };
	assert.equal(assistanceTaskHasControls(settings, [deepfilter]), false);
	assert.equal(assistanceTaskHasControls(settings, [deepfilter, voxlock]), true);
	assert.deepEqual(assistanceTaskSettingsForModels(settings, [voxlock]), { ...settings, modelId: 'voxlock' });
});
