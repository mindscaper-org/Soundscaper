import assert from 'node:assert/strict';
import test from 'node:test';

import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createTrackFolderService } from '../src/common/editor/controller/document/internal/track-folder-service.ts';
import type { AudioEditorCommand } from '../src/common/editor/commands/protocol.ts';

test('wrapping selected tracks shares one hierarchy position index for every structural block', () => {
	const count = 500;
	const project = createSoundscaperProject({ id: 'folder-wrap-work', tracks: Array.from({ length: count }, (_, index) => ({ id: `track-${index}`, clipIds: [] })) });
	const commands: AudioEditorCommand[] = [];
	const service = createTrackFolderService({ lifetime: { assertActive() {} }, getProject: () => project,
		editingBlocked: () => false, createId: () => 'new-folder', commit: command => { commands.push(command); }, publishProjectState() {} });
	const nodes = project.sequences[0]!.trackNodes;
	const original = Array.prototype.findIndex;
	let visits = 0;
	Array.prototype.findIndex = function<T>(this: T[], predicate: (value: T, index: number, array: T[]) => unknown, receiver?: unknown): number {
		return original.call(this, this === nodes ? (value: T, index: number, array: T[]) => { visits++; return predicate.call(receiver, value, index, array); } : predicate, receiver);
	};
	try {
		assert.equal(service.wrapTracksIntoFolder(project.tracks.map(track => track.id), 'All'), 'new-folder');
		assert.ok(visits <= count * 3, `${visits} repeated hierarchy position comparisons`);
	} finally { Array.prototype.findIndex = original; }
	assert.equal(commands.length, 1);
	const command = commands[0];
	assert.equal(command?.type, 'batch');
	if (command?.type !== 'batch') assert.fail('Expected one atomic folder wrap');
	assert.equal(command.commands.length, count + 1);
	assert.deepEqual(command.commands.slice(1).map(move => move.type === 'track-node/move' ? [move.nodeId, move.index] : null),
		project.tracks.map((track, index) => [track.id, index]));
});
