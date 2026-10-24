/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveEditingActionAvailability } from '../src/common/editor/commands/editing-selection-authority.ts';
import { resolveAudacityActionSelectionFacts } from '../src/common/editor/audacity-action-enablement.ts';

test('multitrack action facts resolve selected track identities with linear work', context => {
	let idReads = 0;
	const count = 400;
	const tracks = Array.from({ length: count }, (_, index) => ({ get id() { idReads++; return `track-${index}`; }, type: 'audio', clipIds: [] }));
	const project = { tracks, clips: [], selection: { startFrame: 0, endFrame: 100, trackIds: Array.from({ length: count }, (_, index) => `track-${index}`) } };
	const facts = resolveAudacityActionSelectionFacts({ project, selectedTrackId: 'track-399' });
	assert.equal(facts.selectedTrack, tracks[0]);
	assert.equal(facts.focusedTrack, tracks[399]);
	assert.equal(facts.selectedAudioTrack, tracks[0]);
	assert.equal(facts.selectedMediaTrack, true);
	context.diagnostic(`${idReads} track-ID reads for ${count} selected tracks`);
	assert.ok(idReads <= count * 12, `${idReads} track-ID reads for ${count} selected tracks`);
});

for (const extra of [0, 9]) test(`action facts preserve duplicate-ID and mutable-input authority with ${extra + 1} selected tracks`, () => {
	const extras = Array.from({ length: extra }, (_, index) => ({ id: `extra-${index}`, type: 'label', clipIds: [] }));
	const tracks = [
		{ id: 'duplicate', type: 'label', clipIds: ['clip'] },
		{ id: 'duplicate', type: 'audio', clipIds: ['clip'] },
		{ id: 'last', type: 'audio', clipIds: [] },
		...extras,
	];
	const clip = { id: 'clip', kind: 'audio' };
	const project = { tracks, clips: [clip], selection: { startFrame: 0, endFrame: 100, trackIds: ['duplicate', ...extras.map(track => track.id)] } };
	const facts = resolveAudacityActionSelectionFacts({ project, selectedTrackId: 'duplicate', selectedClipId: 'clip' });
	assert.equal(facts.selectedTrack, tracks[0]);
	assert.equal(facts.focusedTrack, tracks[0]);
	assert.equal(facts.selectedAudioTrack, null);
	assert.equal(facts.audioSelection, false);
	assert.equal(facts.selectedMediaTrack, true);
	assert.equal(facts.selectedAudioClip, null);
	tracks[0]!.type = 'audio';
	assert.equal(resolveAudacityActionSelectionFacts({ project }).selectedAudioTrack, tracks[0]);
});


test('a first-track selection keeps short-circuit lookups without allocating a second project index', context => {
	const reads = { ids: 0, types: 0, clips: 0, maps: 0, sets: 0 };
	const OriginalMap = Map;
	const OriginalSet = Set;
	context.mock.property(globalThis, 'Map', new Proxy(OriginalMap, {
		construct(target, args: ConstructorParameters<typeof Map>) { reads.maps++; return new target(...args); },
	}));
	context.mock.property(globalThis, 'Set', new Proxy(OriginalSet, {
		construct(target, args: ConstructorParameters<typeof Set>) { reads.sets++; return new target(...args); },
	}));
	const tracks = Array.from({ length: 400 }, (_, index) => ({
		get id() { reads.ids++; return `track-${index}`; },
		get type() { reads.types++; return 'audio'; },
		get clipIds() { reads.clips++; return ['clip']; },
	}));
	const project = { tracks, clips: [], selection: { startFrame: 0, endFrame: 100, trackIds: ['track-0'] } };
	resolveEditingActionAvailability({ project, selection: project.selection, focusedTrackId: 'track-0' });
	const authority = { ...reads };
	for (const field of ['ids', 'types', 'clips', 'maps', 'sets'] as const) reads[field] = 0;
	const facts = resolveAudacityActionSelectionFacts({ project, selectedTrackId: 'track-0' });
	const added = { ids: reads.ids - authority.ids, types: reads.types - authority.types,
		clips: reads.clips - authority.clips, maps: reads.maps - authority.maps, sets: reads.sets - authority.sets };
	context.diagnostic(`small-selection work beyond authority: ${JSON.stringify(added)}`);
	assert.equal(facts.selectedTrack, tracks[0]);
	assert.equal(facts.projectHasAudio, true);
	assert.ok(added.ids <= 8, `${added.ids} extra track ID reads`);
	assert.ok(added.types <= 8, `${added.types} extra track type reads`);
	assert.ok(added.clips <= 8, `${added.clips} extra clip-list reads`);
	assert.equal(added.maps, 0, 'small selections must not allocate another track map');
	assert.equal(added.sets, 1, 'only the selected-ID result set is required beyond authority');
});
