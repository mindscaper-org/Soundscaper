/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createAudioEditorProjectV17 } from '../src/common/editor/project-v17.ts';
import { createAudioClip, createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { createConsolidatePlan } from '../src/common/editor/consolidate-plan.ts';

test('Consolidate media does not report a Project Bin source as unreferenced', () => {
	const source = createAudioSource({ id: 'linked', sampleRate: 8000, frameCount: 8000, channelCount: 1 });
	const project = createAudioEditorProjectV17({ sampleRate: 8000, sources: [source],
		projectBin: { clips: [{ ...createAudioClip({ id: 'bin', sourceId: source.id, durationFrames: 8000 }) }] } });
	const plan = createConsolidatePlan({ project, bindings: [{ sourceId: source.id, storageKey: source.id,
		byteLength: 32000, sha256: 'a'.repeat(64), bindingToken: 'binding', kind: 'audio' }] });
	assert.equal(plan.complete, true);
	assert.equal(plan.copy.length, 1);
	assert.equal(plan.report.items.some(item => item.code === 'consolidate.source-unreferenced'), false);
});

test('Consolidate media retains the reference of a take-owned source without ordinary clips', () => {
	const source = createAudioSource({ id: 'take-source', sampleRate: 8000, frameCount: 8000, channelCount: 1 });
	const project = createAudioEditorProjectV17({ sampleRate: 8000, sources: [source],
		tracks: [createAudioTrack({ id: 'track', clipIds: [] }, 8000)],
		sequences: [{ id: 'sequence', trackIds: ['track'] }], primarySequenceId: 'sequence',
		takeGroups: [{ id: 'group', sequenceId: 'sequence', trackId: 'track', startSample: 0, endSample: 8000,
			laneOrder: ['lane'], lanes: [{ id: 'lane' }], takes: [{ id: 'take', laneId: 'lane', sourceId: source.id,
				startSample: 0, endSample: 8000, sourceStartSample: 0 }],
			compRegions: [{ id: 'region', takeId: 'take', startSample: 0, endSample: 8000 }] }] });
	const plan = createConsolidatePlan({ project, bindings: [{ sourceId: source.id, storageKey: source.id,
		byteLength: 32000, sha256: 'a'.repeat(64), bindingToken: 'binding', kind: 'audio' }] });
	assert.equal(plan.report.items.some(item => item.code === 'consolidate.source-unreferenced'), false);
});
