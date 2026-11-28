/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import type { TracktionProjectBridge } from '../src/soundscaper/tracktion-project-contract.ts';
import { readTracktionWorkspaceAfterClipEdit, type TracktionWorkspace } from '../src/soundscaper/tracktion-workspace.ts';

const clip = { id: '1', name: 'Dialogue', start: 0, end: 16, sourceOffset: 3 };
const remaining = { ...clip, id: '3', start: 128, end: 144 };
const destinationClip = { ...clip, id: '2', name: 'Music', start: 16, end: 32 };
const source = { id: '100', name: 'Voice', clipCount: 2 };
const target = { id: '101', name: 'Music', clipCount: 1 };
const tracks = [source, target];
const history = { canUndo: true, canRedo: false };
const project = { ...history, revision: 1, sampleRate: 48_000, nextOffset: null, tracks };
const workspace: TracktionWorkspace = { sessionId: 'session', name: 'Project', project, tracks, selectedTrack: source,
	clips: [clip, remaining], recentClips: [{ trackId: target.id, clips: [destinationClip] }] };
const localOnly: TracktionProjectBridge = { async request() { return assert.fail('The acknowledged placement needs no bridge requests'); } };

void test('a cross-track Move updates cached source and destination rows from its acknowledgement', async () => {
	const moved = { ...clip, start: 128, end: 144 };
	const updated = await readTracktionWorkspaceAfterClipEdit(localOnly, workspace, {
		revision: 2, itemId: null, history, placedClip: { clip: moved, index: 1 },
	}, { trackId: target.id, removedFromSource: clip.id });
	assert.deepEqual(updated.clips, [destinationClip, moved]);
	assert.deepEqual(updated.recentClips, [{ trackId: source.id, clips: [remaining] }]);
	assert.deepEqual(updated.tracks, [{ ...source, clipCount: 1 }, { ...target, clipCount: 2 }]);
	assert.deepEqual(updated.project.tracks, updated.tracks);
	assert.equal(updated.selectedTrack, updated.tracks[1]);
	assert.equal(updated.project.revision, 2);
});

void test('an acknowledged same-track Move uses the returned order and leaves the clip count stable', async () => {
	const moved = { ...clip, start: 256, end: 272 };
	const updated = await readTracktionWorkspaceAfterClipEdit(localOnly, workspace, {
		revision: 2, itemId: null, history, placedClip: { clip: moved, index: 1 },
	});
	assert.deepEqual(updated.clips, [remaining, moved]);
	assert.equal(updated.tracks, tracks);
	assert.equal(updated.recentClips, workspace.recentClips);
});

void test('an acknowledged Duplicate can select an empty destination and preserve its source lane', async () => {
	const empty = { ...target, clipCount: 0 };
	const current = { ...workspace, tracks: [source, empty], project: { ...project, tracks: [source, empty] }, recentClips: [] };
	const copy = { ...clip, id: '4', start: 64, end: 80 };
	const updated = await readTracktionWorkspaceAfterClipEdit(localOnly, current, {
		revision: 2, itemId: copy.id, history, placedClip: { clip: copy, index: 0 },
	}, { trackId: empty.id });
	assert.deepEqual(updated.clips, [copy]);
	assert.deepEqual(updated.recentClips, [{ trackId: source.id, clips: workspace.clips }]);
	assert.equal(updated.tracks[0], source);
	assert.deepEqual(updated.selectedTrack, { ...empty, clipCount: 1 });
});
