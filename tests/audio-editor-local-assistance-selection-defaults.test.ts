/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { loadLocalAssistanceSelectionInventory, selectLocalAssistanceOperation,
	selectLocalAssistanceShotDetectionMode } from
	'../src/common/editor/ui/local-assistance-selection-state.ts';

const source = { sourceId: 'selected-audio', label: 'Audio selection', mediaKind: 'audio' as const,
	operations: ['speech-enhancement' as const, 'shot-detection' as const] };
const enhancement = { modelId: 'deepfilternet3', version: '1', task: 'speech-enhancement',
	artifactSha256s: ['a'.repeat(64)] };
const detector = { modelId: 'transnetv2', version: '1', task: 'shot-detection',
	artifactSha256s: ['b'.repeat(64)] };
const selection = { sources: [source], models: [enhancement, detector], selectedSourceId: source.sourceId,
	selectedOperation: null, selectedModelIds: [], shotDetectionMode: 'fast' as const };

test('the current selection is used without a second media picker', async () => {
	const inventory = await loadLocalAssistanceSelectionInventory({
		listSelectedMedia: () => ({ sources: [source] }), listModels: () => [enhancement],
		isCurrent: () => true,
	});
	assert.equal(inventory?.selectedSourceId, source.sourceId);
});

test('choosing an operation resolves its installed model without a redundant picker', () => {
	const change = selectLocalAssistanceOperation(selection, 'speech-enhancement');
	assert.deepEqual(change.selectedModelIds, [enhancement.modelId]);
});

test('switching to accurate detection resolves the sole installed detector', () => {
	const change = selectLocalAssistanceShotDetectionMode({ ...selection,
		selectedOperation: 'shot-detection' }, 'accurate');
	assert.deepEqual(change.selectedModelIds, [detector.modelId]);
});
