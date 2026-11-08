/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import LocalAssistanceTaskProcessingDialog from
	'../src/common/editor/ui/dialogs/LocalAssistanceTaskProcessingDialog.tsx';
import { INITIAL_LOCAL_ASSISTANCE_GUIDED_SNAPSHOT } from
	'../src/common/editor/ui/local-assistance-guided-session-store.ts';
import { createLocalAssistanceAdvancedWorkflowSessionStore } from
	'../src/common/editor/ui/local-assistance-advanced-session-store.ts';
import { defaultAssistanceWorkflowSettingsV1 } from
	'../src/common/editor/assistance/workflow-settings-v1.ts';
import type { LocalAssistanceSnapshot } from '../src/common/editor/ui/local-assistance-session-types.ts';

const inventory = { ...createLocalAssistanceAdvancedWorkflowSessionStore({ bridge: null, preparation: null }).getSnapshot(),
	phase: 'ready' as const,
	sources: [{ sourceId: 'selection', label: 'Selected audio', mediaKind: 'audio' as const,
		operations: ['speech-enhancement' as const] }],
	models: [{ modelId: 'deepfilternet3', version: '3.0.0', task: 'speech-enhancement', artifactSha256s: ['a'.repeat(64)] }],
};
const guided = { ...INITIAL_LOCAL_ASSISTANCE_GUIDED_SNAPSHOT, phase: 'ready' as const,
	selectedWorkflowId: 'enhance-dialogue' as const,
	settings: defaultAssistanceWorkflowSettingsV1('enhance-dialogue') };
function render(current: LocalAssistanceSnapshot, unavailable = false) {
	return renderToStaticMarkup(<LocalAssistanceTaskProcessingDialog workflowId="enhance-dialogue"
		inventory={current} snapshot={unavailable ? { ...guided, phase: 'unavailable' } : guided}
		error={null} copy={{}} onClose={() => undefined} />);
}

test('menu-invoked effects show cancellable progress without configuration controls', () => {
	const html = render(inventory);
	assert.match(html, /<progress/);
	assert.match(html, />Cancel<\/span>/);
	assert.doesNotMatch(html, /<select|<details|>Apply<|Selected media|Add result to/);
});

test('a model removed after preflight produces an error instead of indefinite progress', () => {
	const html = render({ ...inventory, models: [] });
	assert.match(html, /role="alert"/);
	assert.match(html, /Required models are missing/);
	assert.doesNotMatch(html, /<progress/);
});

test('runtime unavailability does not ask the user to reselect valid audio', () => {
	const html = render(inventory, true);
	assert.match(html, /unavailable for the selected media/);
	assert.doesNotMatch(html, /Select media in the timeline first|<progress/);
});
