/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createProjectBinInstanceCountReader } from '../src/common/editor/project-bin-instance-count-index.ts';
import { createFramescaperProjectBinVisualActions } from '../src/framescaper/editor-project-bin-visual-actions.ts';

test('all visual bin counters share one timeline membership pass', () => {
	let reads = 0;
	const bin = Array.from({ length: 500 }, (_, i) => ({ id: `bin-${i}`, sourceId: `source-${i}`, kind: 'generator' }));
	const clips = Array.from({ length: 500 }, (_, i) => ({ id: `clip-${i}`, get sourceId() { reads++; return `source-${i}`; }, kind: 'generator' }));
	const owner = { project: { projectBin: { clips: bin }, clips }, getSnapshot: () => ({}), getTelemetrySnapshot: () => ({}), selectClips() {}, actions: { projectBin: {}, edit: { commit() {} } } };
	const actions = createFramescaperProjectBinVisualActions(owner);
	for (const item of bin) assert.equal(actions.instanceCount?.(item.id), 1);
	assert.equal(reads, 500);
	owner.project = { ...owner.project, clips: [...clips, { id: 'new', kind: 'generator', sourceId: 'source-0' }] };
	assert.equal(actions.instanceCount?.('bin-0'), 2);
});

test('linked audio/video bin counts deduplicate source membership and retain missing-item admission', () => {
	const read = createProjectBinInstanceCountReader();
	const bin = [{ id: 'audio', binItemId: 'av', sourceId: 'audio-source' }, { id: 'video', binItemId: 'av', sourceId: 'video-source' }, { id: 'audio-alias', binItemId: 'av', sourceId: 'audio-source' }];
	const timeline = [{ sourceId: 'audio-source' }, { sourceId: 'video-source' }, { sourceId: 'audio-source' }, { sourceId: 'other' }];
	assert.equal(read(timeline, bin, 'audio', true), 3);
	assert.equal(read(timeline, bin, 'video', true), 3);
	assert.equal(read(timeline, bin, 'audio', false), 2);
	assert.equal(read(timeline, bin, 'missing', true), undefined);
});
