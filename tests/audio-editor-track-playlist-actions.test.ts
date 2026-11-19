/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createTrackPlaylistActionFacade } from '../src/common/editor/controller/track-audio/track-playlist-action-facade.ts';
import type { TrackPlaylistCommand } from '../src/common/editor/commands/track-playlist.ts';

test('playlist creation waits for pending edits and uses the original project and track authority', async () => {
	let project = { id: 'p', schemaFamily: 'soundscaper', tracks: [{ id: 't', type: 'audio', locked: false }] };
	let release: (() => void) | undefined;
	const ready = new Promise<void>(resolve => { release = resolve; });
	const commands: TrackPlaylistCommand[] = [];
	let id = 0;
	const actions = createTrackPlaylistActionFacade({ getProject: () => project, createId: () => `id-${String(++id)}`,
		commit: command => { commands.push(command); }, prepare: () => ready, assertActive: () => undefined });
	const pending = actions.create('t', ' Edited ', 'duplicate', 'Original');
	assert.equal(commands.length, 0);
	release!();
	const created = await pending;
	assert.equal(created, 'id-1');
	assert.deepEqual(commands[0], { type: 'track/playlist-create', trackId: 't', id: 'id-1', name: 'Edited',
		originalId: 'id-2', originalName: 'Original', mode: 'duplicate' });
	project = { ...project, tracks: [{ id: 't', type: 'audio', locked: true }] };
	await assert.rejects(actions.activate('t', 'id-1'), /locked/iu);
});

test('a project switch during preparation aborts the playlist command', async () => {
	let project = { id: 'first', schemaFamily: 'soundscaper', tracks: [{ id: 't', type: 'audio' }] };
	let committed = false;
	const actions = createTrackPlaylistActionFacade({ getProject: () => project, createId: () => 'unused',
		commit: () => { committed = true; }, prepare: () => { project = { ...project, id: 'second' }; }, assertActive: () => undefined });
	await assert.rejects(actions.create('t', 'New', 'empty', 'Original'), /project changed/iu);
	assert.equal(committed, false);
});
