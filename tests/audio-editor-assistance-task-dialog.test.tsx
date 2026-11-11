/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { LocalAssistanceDialogView } from '../src/common/editor/ui/dialogs/LocalAssistanceDialog.tsx';
import { createLocalAssistanceAdvancedWorkflowSessionStore } from
	'../src/common/editor/ui/local-assistance-advanced-session-store.ts';
import { createLocalAssistanceGuidedSessionStore } from '../src/common/editor/ui/local-assistance-guided-session-store.ts';
import { defaultAssistanceWorkflowSettingsV1 } from '../src/common/editor/assistance/workflow-settings-v1.ts';
import { assistanceTaskModelFilter } from '../src/common/editor/controller/assistance/local-assistance-task-models.ts';
import LocalAssistanceGuidedSettings from '../src/common/editor/ui/dialogs/LocalAssistanceGuidedSettings.tsx';
import type { LocalAssistanceModel } from '../src/common/editor/assistance/local-assistance-bridge.ts';

test('task dialog has a task title and no mode or workflow picker', () => {
	const options = { bridge: null, preparation: null };
	const guided = createLocalAssistanceGuidedSessionStore(options);
	guided.selectWorkflow('enhance-dialogue');
	const html = renderToStaticMarkup(<LocalAssistanceDialogView copy={{}}
		request={{ mode: 'task', workflowId: 'enhance-dialogue' }}
		snapshot={createLocalAssistanceAdvancedWorkflowSessionStore(options).getSnapshot()}
		guided={guided.getSnapshot()}
		onClose={() => undefined} onSelectSource={() => undefined} onSelectOperation={() => undefined}
		onSelectModel={() => undefined} onConsentChange={() => undefined} onRun={() => undefined}
		onCancel={() => undefined} onReview={() => undefined} onAccept={() => undefined} />);
	assert.match(html, /Enhance Dialogue/);
	assert.doesNotMatch(html, /role="tablist"|id="local-assistance-guided-workflow"/);
	assert.match(html, /Selected media/);
	assert.match(html, /aria-label="Model"/);
	assert.doesNotMatch(html, /Technical details|Exact settings/);
});

test('model-manager task filter uses exact workflow models, including selected recognizer', () => {
	const settings = defaultAssistanceWorkflowSettingsV1('transcribe-captions');
	assert.equal(settings.workflowId, 'transcribe-captions');
	const filter = assistanceTaskModelFilter(settings);
	assert.equal(filter({ modelId: 'parakeet-tdt-0.6b-v3', version: '3.0.0', task: 'speech-recognition' }), true);
	assert.equal(filter({ modelId: 'unrelated', version: '1.0', task: 'speech-recognition' }), false);
	assert.equal(filter({ modelId: 'silero-vad-v6', version: '6.2.1', task: 'voice-activity-detection' }), true);
});

test('model-free cuts are ready without downloads; accurate cuts require the exact detector', async () => {
	const { assistanceTaskModelsReady } = await import('../src/common/editor/controller/assistance/local-assistance-task-models.ts');
	const settings = defaultAssistanceWorkflowSettingsV1('mark-cuts');
	assert.equal(assistanceTaskModelsReady(settings, [], [{ mediaKind: 'video' }]), true);
	assert.equal(settings.workflowId, 'mark-cuts');
	if (settings.workflowId !== 'mark-cuts') throw new Error('Wrong settings');
	const accurate = { ...settings, mode: 'accurate' as const };
	assert.equal(assistanceTaskModelsReady(accurate, [], []), false);
	const detector = { modelId: 'transnetv2', version: '1.0.0',
		task: 'shot-detection', artifactSha256s: ['a'.repeat(64)] };
	assert.equal(assistanceTaskModelsReady(accurate, [detector], []), true);
});

test('task footer follows processing and review state without allowing an empty apply', async () => {
	const { LocalAssistanceTaskActions } = await import('../src/common/editor/ui/dialogs/LocalAssistanceTaskSummary.tsx');
	const actions = { copy: {}, canRun: true, canCancel: false, canReview: false, canAccept: false,
		reviewReady: false, onRun: () => undefined, onCancel: () => undefined, onReview: () => undefined,
		onAccept: () => undefined, onClose: () => undefined };
	const initial = renderToStaticMarkup(<LocalAssistanceTaskActions {...actions} />);
	assert.match(initial, /Apply/);
	assert.doesNotMatch(initial, /Apply selected|Review result/);
	const processing = renderToStaticMarkup(<LocalAssistanceTaskActions {...actions} canCancel />);
	assert.match(processing, /Cancel processing/);
	assert.doesNotMatch(processing, /Run locally/);
	assert.match(renderToStaticMarkup(<LocalAssistanceTaskActions {...actions} canReview />), /Review result/);
	const review = renderToStaticMarkup(<LocalAssistanceTaskActions {...actions} reviewReady canReview />);
	assert.match(review, /disabled=""[^>]*><span[^>]*>Apply selected/);
	assert.doesNotMatch(review, /Review result|Run locally/);
});

test('task action labels follow effects, analyzers, and generators', async () => {
	const { LocalAssistanceTaskActions } = await import('../src/common/editor/ui/dialogs/LocalAssistanceTaskSummary.tsx');
	const actions = { copy: {}, canRun: true, canCancel: false, canReview: false, canAccept: false,
		reviewReady: false, onRun: () => undefined, onCancel: () => undefined, onReview: () => undefined,
		onAccept: () => undefined, onClose: () => undefined };
	for (const [workflowId, label] of [['enhance-dialogue', 'Apply'], ['mark-reactions', 'Analyze'],
		['generate-editorial-text', 'Generate']] as const) {
		assert.match(renderToStaticMarkup(<LocalAssistanceTaskActions {...actions} workflowId={workflowId} />),
			new RegExp(`>${label}</span>`));
	}
});

test('transcription offers only installed recognizer alternatives and hides a sole model', () => {
	const settings = defaultAssistanceWorkflowSettingsV1('transcribe-captions');
	const parakeet: LocalAssistanceModel = { modelId: 'parakeet-tdt-0.6b-v3', version: '3.0.0',
		task: 'speech-recognition', artifactSha256s: ['a'.repeat(64)] };
	const whisper: LocalAssistanceModel = { modelId: 'whisper-large-v3-turbo-ggml', version: '1.0.0',
		task: 'speech-recognition', artifactSha256s: ['b'.repeat(64)] };
	const render = (models: readonly LocalAssistanceModel[]) => renderToStaticMarkup(<LocalAssistanceGuidedSettings
		copy={{}} settings={settings} models={models} disabled={false} onChange={() => undefined} />);
	assert.doesNotMatch(render([parakeet]), /aria-label="Model"|Speech recognizer/);
	assert.doesNotMatch(render([whisper]), /aria-label="Model"|Speech recognizer/);
	assert.match(render([parakeet, whisper]), /aria-label="Model"/);
	assert.doesNotMatch(render([parakeet, { ...whisper, version: 'wrong' }]), /aria-label="Model"/);
});
