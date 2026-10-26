/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createAudioClip, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { normalizeAutomationLaneV21 } from '../src/common/editor/automation-lane-v21.ts';
import { exportSequenceProject } from '../src/common/editor/export-sequence-project.ts';
import { createExportRenderProject } from '../src/common/editor/controller/export/export-render-project.ts';
import { createExportPlan } from '../src/common/editor/export.js';
import { mixDetectorProject } from './helpers/next-mix-detector-project.ts';

for (const kind of ['track', 'bus'] as const) test(`sequence export retains its ${kind} detector, VCA and automation without foreign references`, () => {
	const { project: base } = mixDetectorProject(kind);
	const track = createAudioTrack({ id: 'foreign', clipIds: ['foreign-clip'] });
	const assignment = base.mixer.edges.find(edge => edge.source.kind === 'track' && edge.source.id === 'voice' && edge.kind === 'assignment'); assert.ok(assignment);
	const extended = createSoundscaperProject({ ...base, tracks: [...base.tracks, track],
		mixer: { ...base.mixer, edges: [...base.mixer.edges, { ...assignment, id: 'foreign-output', source: { kind: 'track', id: 'foreign' } }] },
		clips: [...base.clips, createAudioClip({ id: 'foreign-clip', sourceId: 'voice', durationFrames: 48_000, sourceDurationFrames: 48_000 })],
		primarySequenceId: 'main', sequences: [{ id: 'main', trackIds: ['voice', 'control'] }, { id: 'other', trackIds: ['foreign'] }] });
	const lane = (id: string, trackId: string) => normalizeAutomationLaneV21({ id,
		address: { kind: 'strip', strip: { kind: 'track', id: trackId }, parameterId: 'gain' },
		timebase: 'absolute-samples', points: [{ id: 'point', position: 0, value: .5 }], segments: [] });
	const project = createSoundscaperProject({ ...extended, mixer: { ...extended.mixer, vcas: [{ id: 'balance', name: 'Balance', gain: .5, mute: false,
		members: ['voice', 'control', 'foreign'].map(id => ({ kind: 'track', id })) }] }, automationLanes: [lane('selected-gain', 'voice'), lane('foreign-gain', 'foreign')] });
	const before = structuredClone(project);
	const delivered = exportSequenceProject(project);
	assert.deepEqual(delivered.tracks.map(item => item.id), ['voice', 'control']);
	assert.ok(delivered.mixer.edges.some(edge => edge.id === 'detector'));
	assert.equal(delivered.mixer.edges.some(edge => edge.source.kind === 'track' && edge.source.id === 'foreign'), false);
	assert.deepEqual(delivered.mixer.vcas[0]?.members, [{ kind: 'track', id: 'voice' }, { kind: 'track', id: 'control' }]);
	assert.deepEqual(delivered.automationLanes.map(item => item.id), ['selected-gain']);
	assert.equal(createExportPlan(delivered, { format: 'wav' }).outputFrames, 48_000, 'the actual PDC/graph compiler admits the delivery');
	assert.deepEqual(project, before);
});

for (const enabled of [true, false]) test(`cross-timeline detector admission remains explicit (effect enabled:${enabled})`, () => {
	const { project: base } = mixDetectorProject('track', enabled);
	const project = createSoundscaperProject({ ...base, primarySequenceId: 'main',
		sequences: [{ id: 'main', trackIds: ['voice'] }, { id: 'other', trackIds: ['control'] }] });
	if (enabled) assert.throws(() => createExportRenderProject(project), /detector from another timeline/u);
	else {
		const delivered = exportSequenceProject(project);
		assert.deepEqual(delivered.tracks.map(track => track.id), ['voice']);
		assert.equal(delivered.mixer.edges.some(edge => edge.id === 'detector'), false);
		assert.equal(createExportPlan(delivered, { format: 'wav' }).outputFrames, 48_000);
	}
});
