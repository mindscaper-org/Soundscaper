/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { assistanceWorkflowRequiresConfirmation } from '../desktop/assistance-workflow-confirmation.ts';
import { defaultAssistanceWorkflowSettingsV1 } from '../src/common/editor/assistance/workflow-settings-v1.ts';
import type { AssistanceWorkflowId } from '../src/common/editor/assistance/workflow-recipes.ts';

const requestFor = (workflowId: AssistanceWorkflowId) => ({ workflowId, settings: defaultAssistanceWorkflowSettingsV1(workflowId) });

test('selection-replacing audio effect commands use their menu invocation as consent', () => {
	for (const workflowId of ['enhance-dialogue', 'reduce-reverb', 'separate-dialogue-music-effects'] as const) {
		const request = requestFor(workflowId);
		assert.equal(assistanceWorkflowRequiresConfirmation(request), false);
	}
});

test('Advanced, reviewed workflows, and non-replacing effect requests retain explicit confirmation', () => {
	for (const workflowId of ['advanced:speech-enhancement', 'clean-filler-silence', 'transcribe-captions'] as const) {
		assert.equal(assistanceWorkflowRequiresConfirmation(requestFor(workflowId)), true);
	}
	const request = requestFor('enhance-dialogue');
	if (request.settings.workflowId !== 'enhance-dialogue') throw new Error('Wrong workflow settings');
	assert.equal(assistanceWorkflowRequiresConfirmation({ ...request,
		settings: { ...request.settings, placement: 'project-bin' } }), true);
});
