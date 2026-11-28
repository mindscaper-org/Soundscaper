/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import type {
	TracktionClipPage, TracktionProjectBridge, TracktionProjectCommand, TracktionProjectPage, TracktionProjectReply,
} from '../src/soundscaper/tracktion-project-contract.ts';
import {
	readTracktionWorkspaceAfterClipEdit, readTracktionWorkspaceAfterSelection, type TracktionWorkspace,
} from '../src/soundscaper/tracktion-workspace.ts';

void test('moving a clip between recently selected tracks replaces both cached clip lists', async () => {
	const [source, target, untouched] = ['Source', 'Target', 'Untouched'].map((name) => ({ id: name, name, clipCount: 1 }));
	const [original, existing, other] = [source, target, untouched].map(({ id }) => ({ id, name: id, start: 0, end: 32, sourceOffset: 0 }));
	const moved = { ...original, start: 32, end: 64 };
	const tracks = [source, target, untouched];
	const project = { revision: 7, sampleRate: 48_000, canUndo: false, canRedo: false, nextOffset: null, tracks };
	const workspace: TracktionWorkspace = {
		sessionId: 'session', name: 'Project', project, tracks, selectedTrack: source, clips: [original],
		recentClips: [{ trackId: target.id, clips: [existing] }, { trackId: untouched.id, clips: [other] }],
	};
	const requests: TracktionProjectCommand[] = [];
	const bridge: TracktionProjectBridge = {
		async request<Command extends TracktionProjectCommand>(command: Command): Promise<TracktionProjectReply<Command>> {
			requests.push(command);
			assert.ok(command.kind === 'project' || command.kind === 'clips' && command.trackId === target.id);
			const reply: TracktionProjectPage | TracktionClipPage = command.kind === 'project'
				? { ...project, revision: 8, canUndo: true, tracks: [{ ...source, clipCount: 0 }, { ...target, clipCount: 2 }, untouched] }
				: { revision: 8, nextOffset: null, clips: [existing, moved] };
			return reply as TracktionProjectReply<Command>;
		},
	};
	const updated = await readTracktionWorkspaceAfterClipEdit(bridge, workspace, { revision: 8, itemId: moved.id }, {
		trackId: target.id, removedFromSource: original.id,
	});
	assert.deepEqual(updated.clips, [existing, moved]);
	const untouchedSelection = await readTracktionWorkspaceAfterSelection(bridge, updated, untouched);
	assert.deepEqual(untouchedSelection.clips, [other]);
	const empty = await readTracktionWorkspaceAfterSelection(bridge, untouchedSelection, updated.tracks[0]);
	assert.deepEqual(empty.clips, []);
	assert.ok(updated.selectedTrack);
	const destination = await readTracktionWorkspaceAfterSelection(bridge, empty, updated.selectedTrack);
	assert.deepEqual(destination.clips, [existing, moved]);
	assert.deepEqual(requests.map(({ kind }) => kind), ['project', 'clips']);
});

void test('adding the first clip to an empty selected track evicts the oldest cached track', async () => {
	const tracks = Array.from({ length: 5 }, (_, index) => ({ id: String(index), name: `Track ${index}`, clipCount: index === 0 ? 0 : 1 }));
	const entries = tracks.slice(1).map(({ id }) => ({ trackId: id,
		clips: [{ id, name: `Clip ${id}`, start: 0, end: 32, sourceOffset: 0 }],
	}));
	const history = { canUndo: true, canRedo: false };
	const project = { revision: 7, sampleRate: 48_000, ...history, nextOffset: null, tracks };
	const workspace: TracktionWorkspace = {
		sessionId: 'session', name: 'Project', project, tracks, selectedTrack: tracks[0], clips: [], recentClips: entries,
	};
	const clip = { id: 'imported', name: 'Imported', start: 16, end: 48, sourceOffset: 0 };
	const bridge: TracktionProjectBridge = { async request() { return assert.fail('Import placement needs no reread'); } };
	const updated = await readTracktionWorkspaceAfterClipEdit(bridge, workspace, {
		revision: 8, itemId: clip.id, history, importedClip: { index: 0, clip },
	});
	assert.deepEqual(updated.clips, [clip]);
	assert.deepEqual(updated.recentClips, entries.slice(0, 3));
});
