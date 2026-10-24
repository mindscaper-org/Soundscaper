/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createSelectedLabelClipboardService } from '../src/common/editor/controller/edit/internal/selected-label-clipboard.ts';
import type { AudioEditorClipboard } from '../src/common/editor/commands/protocol.ts';

test('E11 selected-label copy resolves a batch without rescanning labels per selection', context => {
	let reads = 0;
	const labels = Array.from({ length: 100 }, (_, index) => ({ get id() { reads += 1; return `label-${index}`; }, title: `Label ${index}`, startFrame: index, endFrame: index + 1 }));
	const project = { id: 'project', sampleRate: 48000, tracks: [{ id: 'labels', type: 'label', labels }] };
	const state = { clipboard: null as AudioEditorClipboard | null, selectedTrackId: 'labels', selectedClipId: null, selectedLabelsProjectId: 'project', selectedLabels: labels.map((_, index) => ({ trackId: 'labels', labelId: `label-${index}` })) };
	const service = createSelectedLabelClipboardService({ state, getProject: () => project, getPositionFrames: () => 0, createId: () => 'unused', updateSelection: () => undefined, commit: () => undefined, prepareClipboard: descriptor => () => { state.clipboard = descriptor; }, publish: () => undefined, copy: { labelTrackMissing: 'Missing' }, setStatus: () => undefined });
	assert.equal(service.handle('copy'), true);
	assert.ok(reads <= 500, `label identity reads ${reads}`);
	context.diagnostic(`E11 label identity reads: ${reads}`);
	assert.equal(state.clipboard?.schemaVersion, 7);
	if (state.clipboard?.schemaVersion !== 7) throw new Error('Expected label clipboard');
	assert.ok(state.clipboard.labels);
	assert.equal(state.clipboard.labels.length, 100);
	assert.equal(state.clipboard.labels[99]!.title, 'Label 99');
	labels[99]!.title = 'Edited';
	assert.equal(service.handle('copy'), true);
	assert.ok(state.clipboard.labels);
	assert.equal(state.clipboard.labels[99]!.title, 'Edited');
	assert.equal(service.handle('unhandled'), false);
});
