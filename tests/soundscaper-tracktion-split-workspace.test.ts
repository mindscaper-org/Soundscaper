/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	TRACKTION_CLIP_PAGE_SIZE, type TracktionClipPage, type TracktionProjectBridge,
	type TracktionProjectCommand, type TracktionProjectPage, type TracktionProjectReply,
} from '../src/soundscaper/tracktion-project-contract.ts';
import { readTracktionWorkspaceAfterClipEdit, type TracktionWorkspace } from '../src/soundscaper/tracktion-workspace.ts';

const clips = Array.from({ length: 128 }, (_, index) => ({
	id: String(index + 1), name: `Clip ${index + 1}`, start: index * 16, end: index * 16 + 160, sourceOffset: 5,
}));
const selectedTrack = { id: '200', name: 'Voice track', clipCount: clips.length };
const tracks = [selectedTrack];
const project = { revision: 7, sampleRate: 48_000, canUndo: true, canRedo: true, nextOffset: null, tracks };
const workspace: TracktionWorkspace = { sessionId: 'session', name: 'Project', project, tracks, selectedTrack, clips, recentClips: [] };
const original = clips[63];
const left = { ...original, end: original.start + 65 };
const right = { ...original, id: '140', start: left.end, sourceOffset: original.sourceOffset + 65 };
const history = { canUndo: true, canRedo: false };
const edit = { revision: 8, itemId: right.id };
const splitClips = { left: { clip: left, index: 63 }, right: { clip: right, index: 68 } };
const expected = [...clips.slice(0, 63), left, ...clips.slice(64, 68), right, ...clips.slice(68)];

void test('Split uses both placements across a clip page boundary without rereading the track', async () => {
	const bridge: TracktionProjectBridge = { async request() { return assert.fail('An acknowledged Split needs no bridge requests'); } };
	const updated = await readTracktionWorkspaceAfterClipEdit(bridge, workspace, { ...edit, history, splitClips });
	assert.deepEqual(updated.clips, expected);
	assert.equal(updated.clips[63], left);
	assert.equal(updated.clips[68], right);
	assert.equal(updated.clips[69], clips[68]);
	assert.deepEqual(updated.selectedTrack, { ...selectedTrack, clipCount: 129 });
	assert.equal(updated.tracks[0], updated.selectedTrack);
	assert.equal(updated.project.tracks[0], updated.selectedTrack);
	assert.equal(updated.project.revision, 8);
	assert.equal(updated.project.canRedo, false);
});

void test('Split without usable placements keeps the original track refresh', async () => {
	for (const result of [edit, { ...edit, history, splitClips: { ...splitClips, right: { clip: right, index: 63 } } }]) {
		const requests: TracktionProjectCommand[] = [];
		const bridge: TracktionProjectBridge = {
			async request<Command extends TracktionProjectCommand>(command: Command): Promise<TracktionProjectReply<Command>> {
				requests.push(command);
				if (command.kind === 'project') {
					const reply: TracktionProjectPage = { ...project, ...history, revision: 8,
						tracks: [{ ...selectedTrack, clipCount: expected.length }] };
					return reply as TracktionProjectReply<Command>;
				}
				assert.equal(command.kind, 'clips');
				const next = command.offset + TRACKTION_CLIP_PAGE_SIZE;
				const page: TracktionClipPage = { revision: 8, nextOffset: next < expected.length ? next : null,
					clips: expected.slice(command.offset, next) };
				return page as TracktionProjectReply<Command>;
			},
		};
		const loaded = await readTracktionWorkspaceAfterClipEdit(bridge, workspace, result);
		assert.deepEqual(loaded.clips, expected);
		assert.deepEqual(requests.map(({ kind }) => kind), ['project', 'clips', 'clips', 'clips']);
	}
});
