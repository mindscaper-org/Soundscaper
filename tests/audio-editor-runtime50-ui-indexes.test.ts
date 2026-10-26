/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createTrackSelectionContextMenuItems } from '../src/common/editor/ui/timeline/track-selection-context-menu.ts';
import { trackFolderRowTabIndex, resolveTrackFolderTreeKey, type TrackListRowPlan, type TrackFolderRowUiModel } from '../src/common/editor/ui/timeline/track-folder-ui-model.ts';
import { resolveSplitToolGuidelineFrame, splitToolTrackHasClipAt } from '../src/common/editor/ui/timeline/timeline-tool-precedence.ts';

void test('U04 channel menu indexes project media once instead of once per partner', () => {
	let clipReads = 0, sourceReads = 0;
	const clips = Array.from({ length: 100 }, (_, index) => ({ get id() { clipReads++; return `c${index}`; }, sourceId: 's' }));
	const sources = [{ get id() { sourceReads++; return 's'; }, channelCount: 1 }];
	const tracks = Array.from({ length: 100 }, (_, index) => ({ id: `t${index}`, type: 'audio', clipIds: [`c${index}`] }));
	const result = createTrackSelectionContextMenuItems({ project: { clips, sources, tracks }, track: tracks[0]!, audioEffects: true, blocked: false, copy: {}, actions: { makeStereo() {} } });
	assert.equal(result.audio[0]?.items?.[0]?.disabled, false);
	assert.ok(clipReads <= 100, `clip reads ${clipReads}`);
	assert.ok(sourceReads <= 1, `source reads ${sourceReads}`);
});

void test('U05 stereo tracks and disabled audio menus do not inspect potential mono partners', () => {
	let partnerReads = 0;
	const track = { id: 'first', type: 'audio', clipIds: ['c'] };
	const partners = Array.from({ length: 100 }, (_, index) => ({ id: String(index), get type() { partnerReads++; return 'audio'; }, clipIds: [] }));
	const input = { project: { clips: [{ id: 'c', sourceId: 's' }], sources: [{ id: 's', channelCount: 2 }], tracks: [track, ...partners] }, track, audioEffects: true, blocked: false, copy: {} };
	createTrackSelectionContextMenuItems(input);
	assert.equal(partnerReads, 0);
	createTrackSelectionContextMenuItems({ ...input, audioEffects: false });
	assert.equal(partnerReads, 0);
});

function measuredPlan(count: number) {
	let idReads = 0, visibilityReads = 0;
	const rows: TrackFolderRowUiModel[] = Array.from({ length: count }, (_, index) => Object.freeze({
		get id() { idReads++; return `f${index}`; }, name: String(index), sequenceId: 'main', parentFolderId: null,
		level: 1, posInSet: index + 1, setSize: count, collapsed: false, hidden: false, mute: false, solo: false,
		hasAudioDescendant: false, get rowHidden() { visibilityReads++; return false; }, domId: String(index),
	}));
	const plan: TrackListRowPlan = Object.freeze({ hasFolders: true, entries: Object.freeze([]), folderRows: Object.freeze(rows), treeOwnedIds: '' });
	return { rows, plan, reads: () => ({ idReads, visibilityReads }) };
}

void test('U06 folder tab stops perform one plan index pass for a complete row render', () => {
	const { rows, plan, reads } = measuredPlan(200);
	const result = rows.map(row => trackFolderRowTabIndex(row, 'f199', plan));
	assert.equal(result.filter(value => value === 0).length, 1);
	assert.equal(result[199], 0);
	assert.ok(reads().idReads < 1200, JSON.stringify(reads()));
	assert.ok(reads().visibilityReads < 800, JSON.stringify(reads()));
});

void test('U07 folder keyboard traversal reuses the immutable visible order and invalidates replacement plans', () => {
	const { plan, reads } = measuredPlan(200);
	for (let index = 0; index < 100; index++) assert.deepEqual(resolveTrackFolderTreeKey('ArrowDown', 'f100', plan), { kind: 'focus', folderId: 'f101' });
	assert.ok(reads().visibilityReads <= 200, JSON.stringify(reads()));
	const changed = Object.freeze({ ...plan, folderRows: Object.freeze(plan.folderRows.slice(0, 101)) });
	assert.equal(resolveTrackFolderTreeKey('ArrowDown', 'f100', changed), null);
});

void test('U08 split hover edge search reuses sorted immutable boundaries and refreshes edits', () => {
	let startReads = 0;
	const clips = Object.freeze(Array.from({ length: 500 }, (_, index) => Object.freeze({ id: String(index), get timelineStartFrame() { startReads++; return index * 100; }, durationFrames: 50 })));
	const tracks = Object.freeze([Object.freeze({ id: 't', clipIds: Object.freeze(clips.map(clip => clip.id)) })]);
	const project = { clips, tracks };
	for (let index = 0; index < 30; index++) assert.equal(resolveSplitToolGuidelineFrame({ project, frame: 249, pixelsPerSecond: 1, sampleRate: 1 }), 250);
	assert.ok(startReads <= 1000, `start reads ${startReads}`);
	const changed = { ...project, clips: Object.freeze([...clips, Object.freeze({ id: 'new', timelineStartFrame: 248, durationFrames: 1 })]), tracks: Object.freeze([Object.freeze({ id: 't', clipIds: Object.freeze([...tracks[0]!.clipIds, 'new']) })]) };
	assert.equal(resolveSplitToolGuidelineFrame({ project: changed, frame: 248, pixelsPerSecond: 1, sampleRate: 1 }), 248);
	const mutable = { clips: [{ id: 'm', timelineStartFrame: 10, durationFrames: 5 }], tracks: [{ id: 't', clipIds: ['m'] }] };
	assert.equal(resolveSplitToolGuidelineFrame({ project: mutable, frame: 11, pixelsPerSecond: 1, sampleRate: 1 }), 10);
	mutable.clips[0]!.timelineStartFrame = 11;
	assert.equal(resolveSplitToolGuidelineFrame({ project: mutable, frame: 11, pixelsPerSecond: 1, sampleRate: 1 }), 11);
});

void test('U09 split hit testing indexes clip identity once and still observes mutable replacements', () => {
	let reads = 0;
	const clips = Object.freeze(Array.from({ length: 500 }, (_, index) => Object.freeze({ get id() { reads++; return String(index); }, timelineStartFrame: index * 100, durationFrames: 50 })));
	const tracks = [{ id: 't', clipIds: ['498', '499'] }];
	for (let index = 0; index < 30; index++) assert.equal(splitToolTrackHasClipAt(tracks, clips, 't', 49901), true);
	assert.ok(reads <= 500, `clip identity reads ${reads}`);
	assert.equal(splitToolTrackHasClipAt(tracks, clips, 't', 49999), false);
	const mutable = [{ id: 'a', timelineStartFrame: 0, durationFrames: 5 }];
	assert.equal(splitToolTrackHasClipAt([{ id: 't', clipIds: ['a'] }], mutable, 't', 2), true);
	mutable[0]!.id = 'b';
	assert.equal(splitToolTrackHasClipAt([{ id: 't', clipIds: ['a'] }], mutable, 't', 2), false);
});

void test('indexed folder navigation observes mutable nested rows and resolves hidden active ancestors', () => {
	const { plan } = measuredPlan(3);
	const parent = { ...plan.folderRows[0]!, collapsed: true };
	const child = { ...plan.folderRows[1]!, parentFolderId: parent.id, rowHidden: true };
	const mutablePlan = Object.freeze({ ...plan, folderRows: Object.freeze([parent, child]) });
	assert.equal(trackFolderRowTabIndex(parent, child.id, mutablePlan), 0);
	assert.deepEqual(resolveTrackFolderTreeKey('ArrowRight', parent.id, mutablePlan), { kind: 'expand', folderId: parent.id });
	parent.collapsed = false; child.rowHidden = false;
	assert.deepEqual(resolveTrackFolderTreeKey('ArrowRight', parent.id, mutablePlan), { kind: 'focus', folderId: child.id });
	assert.equal(trackFolderRowTabIndex(child, child.id, mutablePlan), 0);
});

void test('split indexes preserve first duplicate clip semantics and never match NaN IDs', () => {
	const clips = Object.freeze([Object.freeze({ id: 'same', timelineStartFrame: 0, durationFrames: 5 }), Object.freeze({ id: 'same', timelineStartFrame: 50, durationFrames: 5 }),
		...Array.from({ length: 130 }, (_, index) => Object.freeze({ id: String(index), timelineStartFrame: 100, durationFrames: 5 })), Object.freeze({ id: Number.NaN, timelineStartFrame: 0, durationFrames: 5 })]);
	assert.equal(splitToolTrackHasClipAt([{ id: 't', clipIds: ['same'] }], clips, 't', 52), false);
	assert.equal(splitToolTrackHasClipAt([{ id: 't', clipIds: ['same'] }], clips, 't', 2), true);
	assert.equal(splitToolTrackHasClipAt([{ id: 't', clipIds: [Number.NaN] }], clips, 't', 2), false);
});

void test('menu partner discovery prefers the first later mono track including its lock authority', () => {
	const tracks = [{ id: 'before', type: 'audio', clipIds: ['c'] }, { id: 'current', type: 'audio', clipIds: ['c'] }, { id: 'locked', type: 'audio', clipIds: ['c'], locked: true }, { id: 'after', type: 'audio', clipIds: ['c'] }];
	const project = { tracks, clips: [{ id: 'c', sourceId: 's' }], sources: [{ id: 's', channelCount: 1 }] };
	const input = { project, track: tracks[1]!, audioEffects: true, blocked: false, copy: {}, actions: { makeStereo() {} } };
	assert.equal(createTrackSelectionContextMenuItems(input).audio[0]?.items?.[0]?.disabled, true);
	assert.equal(createTrackSelectionContextMenuItems({ ...input, project: { ...project, tracks: tracks.slice(0, 2) } }).audio[0]?.items?.[0]?.disabled, false);
});
