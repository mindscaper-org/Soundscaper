/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { assertFolderContentEditable, folderContentTarget, folderContentSpans } from '../src/common/editor/folder-content-editing.ts';

const project = {
	tracks: [
		{ id: 'voice', type: 'audio', clipIds: ['v'] },
		{ id: 'room', type: 'audio', clipIds: ['r'] },
		{ id: 'music', type: 'audio', clipIds: ['m'] },
	],
	clips: [
		{ id: 'v', timelineStartFrame: 10, durationFrames: 20 },
		{ id: 'r', timelineStartFrame: 20, durationFrames: 25 },
		{ id: 'm', timelineStartFrame: 0, durationFrames: 90 },
	],
	sequences: [{ id: 'main', trackNodes: [
		{ kind: 'folder' as const, id: 'dialogue', parentFolderId: null },
		{ kind: 'track' as const, id: 'voice', parentFolderId: 'dialogue' },
		{ kind: 'folder' as const, id: 'ambience', parentFolderId: 'dialogue' },
		{ kind: 'track' as const, id: 'room', parentFolderId: 'ambience' },
		{ kind: 'track' as const, id: 'music', parentFolderId: null },
	] }],
};

test('folder editing resolves nested descendants in document order independently of visibility', () => {
	const target = folderContentTarget(project, 'dialogue');
	assert.deepEqual(target.trackIds, ['voice', 'room']);
	assert.equal(target.sequenceId, 'main');
	assert.deepEqual(target.range, { startFrame: 10, endFrame: 45 });
	assert.deepEqual(folderContentTarget(project, 'ambience').trackIds, ['room']);
	assert.throws(() => folderContentTarget(project, 'music'), /folder/iu);
	assert.throws(() => folderContentTarget(project, 'missing'), /folder/iu);
});

test('folder overview merges overlapping intervals without filling gaps or including outside tracks', () => {
	assert.deepEqual(folderContentSpans(project, ['voice', 'room']), [{ startFrame: 10, endFrame: 45 }]);
	assert.deepEqual(folderContentSpans({ ...project, clips: [project.clips[0]!, { ...project.clips[1]!, timelineStartFrame: 40 }] }, ['voice', 'room']), [
		{ startFrame: 10, endFrame: 30 }, { startFrame: 40, endFrame: 65 },
	]);
});

test('folder edit admission refuses locked descendants and links crossing the subtree boundary', () => {
	assert.doesNotThrow(() => assertFolderContentEditable(project, ['voice', 'room']));
	assert.throws(() => assertFolderContentEditable({ ...project, tracks: project.tracks.map(track => ({ ...track, locked: track.id === 'room' })) }, ['voice', 'room']), /locked/u);
	assert.throws(() => assertFolderContentEditable({ ...project, clips: project.clips.map(clip => ({ ...clip, avLinkId: clip.id === 'r' ? null : 'outside-pair' })) }, ['voice', 'room']), /outside/u);
});
