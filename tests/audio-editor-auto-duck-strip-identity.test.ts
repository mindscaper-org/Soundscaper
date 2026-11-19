/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createEffect } from '../src/common/editor/effects.js';
import type { MixerEdgeV21 } from '../src/common/editor/mixer-graph-v21.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { applySoundscaperProjectCommand } from '../src/soundscaper/editor-project-commands.ts';

test('Auto Duck reconciliation keeps destination-scoped detector preferences for reused effect IDs', () => {
	const original = createSoundscaperProject({ tracks: ['track-a', 'track-b', 'detector-a', 'detector-b', 'advanced'].map(id => {
		const controlTrackId = id === 'track-a' ? 'detector-a' : id === 'track-b' ? 'detector-b' : null;
		const effects = controlTrackId ? [createEffect('audacity-auto-duck', { id: 'same-effect-id', context: { controlTrackId } })] : [];
		return { id, type: 'audio', effects };
	}) });
	const edges: MixerEdgeV21[] = [['track-a', 'advanced'], ['track-b', 'detector-b']].map(([id, detector]) => ({
		id: `route-${id}`, kind: 'sidechain', source: { kind: 'track', id: detector! },
		destination: { kind: 'effect-sidechain', strip: { kind: 'track', id: id! }, effectId: 'same-effect-id' },
		position: 'pre-fader', level: 0.25, enabled: true, channelMap: [],
	}));
	let project = createSoundscaperProject({ ...original, mixer: { ...original.mixer, edges: [...original.mixer.edges, ...edges] } });
	const findRoutes = () => project.mixer.edges.filter(edge => edge.destination.kind === 'effect-sidechain');
	assert.equal(findRoutes().length, 2);
	const firstRack = findRoutes().find(edge => edge.destination.kind === 'effect-sidechain'
		&& edge.destination.strip.kind === 'track' && edge.destination.strip.id === 'track-a');
	assert.ok(firstRack);
	assert.deepEqual(findRoutes().find(edge => edge.id === firstRack.id)?.source, { kind: 'track', id: 'advanced' });
	project = applySoundscaperProjectCommand(project, { type: 'effect/update', scope: 'track', trackId: 'track-b',
		effectId: 'same-effect-id', changes: { params: { duckAmount: -12 } } });
	const preserved = findRoutes().find(edge => edge.id === firstRack.id);
	assert.deepEqual(preserved?.source, { kind: 'track', id: 'advanced' });
	assert.equal(preserved?.level, 0.25);
});
