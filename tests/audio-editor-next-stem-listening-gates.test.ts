/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeAutomationLaneV21 } from '../src/common/editor/automation-lane-v21.ts';
import { projectProductionStemSnapshot } from '../src/common/editor/controller/export/internal/production-stem-projection.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { mixDetectorProject } from './helpers/next-mix-detector-project.ts';

for (const kind of ['track', 'bus'] as const) test(`NP047: stems retire programme mute automation while preserving ${kind} detector control`, () => {
	const base = mixDetectorProject(kind);
	const lane = (id: string, trackId: string, parameterId: string, value: number) => normalizeAutomationLaneV21({
		id, address: { kind: 'strip', strip: { kind: 'track', id: trackId }, parameterId },
		timebase: 'absolute-samples', points: [{ id: `${id}-point`, position: 0, value }], segments: [],
	});
	const project = createSoundscaperProject({ ...base.project, automationLanes: [
		lane('target-gate', 'voice', 'mute', 1), lane('control-gate', 'control', 'mute', 1),
		lane('target-gain', 'voice', 'gain', .5),
	] });
	const before = structuredClone(project);
	const stem = structuredClone(project); projectProductionStemSnapshot(stem, 'voice');
	assert.deepEqual(stem.automationLanes.map(lane => lane.id), ['control-gate', 'target-gain']);
	assert.deepEqual(stem.automationLanes[0], project.automationLanes[1], 'the external detector retains its authored mute');
	assert.deepEqual(stem.automationLanes[1], project.automationLanes[2], 'programme gain remains authored processing');
	assert.equal(stem.tracks.find(track => track.id === 'voice')?.mute, false);
	assert.equal(stem.mixer.edges.find(edge => edge.id === 'detector')?.level, project.mixer.edges.find(edge => edge.id === 'detector')?.level);
	assert.deepEqual(structuredClone(project), before);
});
