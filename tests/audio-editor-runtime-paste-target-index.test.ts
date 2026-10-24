/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createClipboardPasteSequencePlan, planClipboardPasteTargets } from '../src/common/editor/clipboard-paste-targets.ts';

const copied = (id: string, type = 'audio', group?: string, sequence?: string) => ({ sourceTrackId: id, sourceTrackType: type, sourceLaneGroupId: group, sourceSequenceId: sequence, clips: [] });

test('large multitrack pastes inspect destination types linearly', context => {
	let inspections = 0;
	const count = 600;
	const tracks = Array.from({ length: count }, (_, index) => ({ id: `target-${index}`, get type() { inspections++; return 'audio'; }, clipIds: [] }));
	const clipboard = Array.from({ length: count }, (_, index) => copied(`copied-${index}`));
	const plan = planClipboardPasteTargets(tracks, 'target-0', clipboard);
	assert.deepEqual(plan.map(group => group[0]?.target?.id), tracks.map(track => track.id));
	context.diagnostic(`${inspections} destination type inspections for ${count} tracks`);
	assert.ok(inspections <= count * 12, `${inspections} destination type inspections for ${count} tracks`);
});

test('paste target queues preserve first media IDs, ordering, sequence scopes, and paired lane ownership', () => {
	const tracks = [
		{ id: 'anchor', type: 'audio', clipIds: [] },
		{ id: 'duplicate', type: 'label', clipIds: [] },
		{ id: 'duplicate', type: 'audio', clipIds: [], locked: true },
		{ id: 'duplicate', type: 'audio', clipIds: [] },
		{ id: 'picture', type: 'video', clipIds: [], laneGroupId: 'camera' },
		{ id: 'sound', type: 'audio', clipIds: [], laneGroupId: 'camera' },
		{ id: 'later', type: 'audio', clipIds: [] },
	];
	const clipboard = [copied('old-a'), copied('old-b'), copied('old-v', 'video', 'old-camera'), copied('old-s', 'audio', 'old-camera'), copied('old-c')];
	const sequence = { sequenceByTrackId: new Map([['anchor', 'one'], ['duplicate', 'two'], ['picture', 'two'], ['sound', 'two'], ['later', 'one']]), targetSequenceBySourceTrackId: new Map([['old-a', 'two'], ['old-b', 'one']]) };
	const plan = planClipboardPasteTargets(tracks, 'anchor', clipboard, sequence);
	assert.deepEqual(plan.map(group => group.map(entry => entry.target?.id ?? null)), [['duplicate'], ['anchor'], [null, null], ['sound']]);
	assert.equal(plan[0]?.[0]?.target, tracks[2]);
	const paired = planClipboardPasteTargets(tracks, 'sound', clipboard.slice(2, 4));
	assert.deepEqual(paired.map(group => group.map(entry => entry.target?.id)), [['picture', 'sound']]);
	tracks[2]!.id = 'renamed';
	assert.equal(planClipboardPasteTargets(tracks, null, [copied('duplicate')])[0]?.[0]?.target, tracks[3]);
});

test('sequence destinations preserve original ownership and selected sequence precedence', () => {
	const project = { primarySequenceId: 'primary', sequences: [{ id: 'one', trackIds: ['a'] }, { id: 'two', trackIds: ['b'] }] };
	const clipboard = [copied('a', 'audio', undefined, 'copied'), copied('new', 'audio', undefined, 'copied'), copied('missing', 'audio', undefined, 'two')];
	assert.deepEqual([...createClipboardPasteSequencePlan(project, null, clipboard).targetSequenceBySourceTrackId], [['a', 'one'], ['new', 'one'], ['missing', 'two']]);
	assert.deepEqual([...createClipboardPasteSequencePlan(project, 'b', clipboard).targetSequenceBySourceTrackId.values()], ['two', 'two', 'two']);
});


test('paste candidates skip used IDs across scoped and unscoped queues and preserve pair ordering', () => {
	const tracks = [
		{ id: 'before', type: 'audio', clipIds: [] },
		{ id: 'anchor', type: 'video', clipIds: [] },
		{ id: 'one', type: 'audio', clipIds: [] },
		{ id: 'two', type: 'audio', clipIds: [] },
		{ id: 'three', type: 'audio', clipIds: [] },
	];
	const clipboard = [copied('scoped'), copied('free'), copied('another'), copied('before'), copied('absent')];
	const sequences = { sequenceByTrackId: new Map([['one', 'a'], ['two', 'b'], ['three', 'a']]), targetSequenceBySourceTrackId: new Map([['scoped', 'b'], ['another', 'a']]) };
	assert.deepEqual(planClipboardPasteTargets(tracks, 'anchor', clipboard, sequences).map(group => group[0]?.target?.id ?? null), ['two', 'one', 'three', 'before', null]);
	const reversed = [{ id: 'audio', type: 'audio', clipIds: [], laneGroupId: 'pair' }, { id: 'video', type: 'video', clipIds: [], laneGroupId: 'pair' }];
	assert.deepEqual(planClipboardPasteTargets(reversed, 'audio', [copied('old-v', 'video', 'old'), copied('old-a', 'audio', 'old')]).map(group => group.map(entry => entry.target)), [[null, null]]);
	assert.deepEqual(planClipboardPasteTargets(reversed, null, [copied('video', 'video', 'old'), copied('audio', 'audio', 'old')]).map(group => group.map(entry => entry.target?.id)), [['video', 'audio']]);
});
