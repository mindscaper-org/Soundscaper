/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { defaultAssistanceWorkflowSettingsV1 } from '../src/common/editor/assistance/workflow-settings-v1.ts';
import { assistanceTaskHasControls, assistanceTaskRecognizerChoices, assistanceTaskSettingsForModels,
	assistanceOperationActionLabel } from '../src/common/editor/ui/local-assistance-task-controls.ts';

const WHISPER = { modelId: 'whisper-large-v3-turbo-ggml', version: '1.0.0', task: 'speech-recognition' };
const PARAKEET = { modelId: 'parakeet-tdt-0.6b-v3', version: '3.0.0', task: 'speech-recognition' };

test('fixed audio effects have no controls after their destination becomes implicit', () => {
	for (const id of ['enhance-dialogue', 'reduce-reverb', 'separate-dialogue-music-effects'] as const) {
		assert.equal(assistanceTaskHasControls(defaultAssistanceWorkflowSettingsV1(id), []), false);
	}
	assert.equal(assistanceTaskHasControls(defaultAssistanceWorkflowSettingsV1('clean-filler-silence'), []), true);
	assert.equal(assistanceTaskHasControls(defaultAssistanceWorkflowSettingsV1('mark-reactions'), []), true);
	assert.equal(assistanceTaskHasControls(defaultAssistanceWorkflowSettingsV1('advanced:speech-enhancement'), []), false);
});

test('a sole installed recognizer becomes the hidden default while multiple choices retain the user choice', () => {
	const initial = defaultAssistanceWorkflowSettingsV1('transcribe-captions');
	assert.equal(initial.workflowId, 'transcribe-captions');
	if (initial.workflowId !== 'transcribe-captions') throw new Error('Unexpected settings');
	assert.deepEqual(assistanceTaskSettingsForModels(initial, [WHISPER]), { ...initial, recognizer: 'whisper' });
	assert.strictEqual(assistanceTaskSettingsForModels(initial, [WHISPER, PARAKEET]), initial);
	assert.strictEqual(assistanceTaskSettingsForModels(initial, []), initial);
	assert.deepEqual(assistanceTaskRecognizerChoices([WHISPER, { ...PARAKEET, version: 'untrusted' }]),
		[{ recognizer: 'whisper', modelId: WHISPER.modelId }]);
});

test('primitive action labels match their operation and use translated generic actions', () => {
	assert.equal(assistanceOperationActionLabel('speech-enhancement', { apply: 'Anwenden' }), 'Anwenden');
	assert.equal(assistanceOperationActionLabel('speech-recognition', { analyze: 'Analysieren' }), 'Analysieren');
	assert.equal(assistanceOperationActionLabel('editorial-generation', { generate: 'Erzeugen' }), 'Erzeugen');
});
