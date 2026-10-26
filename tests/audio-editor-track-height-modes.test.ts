/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createTrackHeightModeService } from '../src/common/editor/controller/transport/internal/track-height-mode-service.ts';

function fixture() {
	let project = { id: 'project', tracks: [{ id: 'a', height: 220 }, { id: 'b', height: 160 }] };
	let blocked = false;
	const state = { autoFitTrackHeight: false, visibleTrackHeights: {} as Record<string, number> };
	const batches: unknown[] = [];
	const service = createTrackHeightModeService({
		getProject: () => project, state, editingBlocked: () => blocked, publishProjectState() {},
		commit(command) {
			batches.push(command);
			project = { ...project, tracks: project.tracks.map(track => ({ ...track,
				height: command.commands.find(item => item.trackId === track.id)?.changes.height ?? track.height })) };
			state.visibleTrackHeights = {};
			return project;
		},
	});
	return { service, state, batches, project: () => project,
		setBlocked(value: boolean) { blocked = value; },
		setProjectId(id: string) { project = { ...project, id }; },
	};
}

test('collapse remembers the displayed height and expand restores it without changing other rows', () => {
	const f = fixture();
	f.state.autoFitTrackHeight = true;
	f.state.visibleTrackHeights = { a: 280, b: 180 };
	f.service('collapse', ['a']);
	assert.deepEqual(f.project().tracks.map(track => track.height), [40, 180]);
	assert.equal(f.state.autoFitTrackHeight, false);
	f.service('collapse', ['a']);
	f.service('expand', ['a']);
	assert.deepEqual(f.project().tracks.map(track => track.height), [280, 180]);
	f.service('expand', ['a']);
	assert.deepEqual(f.project().tracks.map(track => track.height), [114, 180]);
});

test('fit divides the available viewport or reserves the other tracks for a single-track fit', () => {
	const f = fixture();
	f.service('fit', ['a'], 600);
	assert.deepEqual(f.project().tracks.map(track => track.height), [440, 160]);
	f.service('fit', undefined, 301);
	assert.deepEqual(f.project().tracks.map(track => track.height), [150, 150]);
	f.service('fit', undefined, 10);
	assert.deepEqual(f.project().tracks.map(track => track.height), [40, 40]);
});

test('fit and project switches retire collapsed height memory; blocked commands preserve state', () => {
	const f = fixture();
	f.service('collapse');
	f.service('fit', undefined, 80);
	f.service('expand');
	assert.deepEqual(f.project().tracks.map(track => track.height), [114, 114]);
	f.service('collapse');
	f.setProjectId('another');
	f.service('expand');
	assert.deepEqual(f.project().tracks.map(track => track.height), [114, 114]);
	const count = f.batches.length;
	f.setBlocked(true);
	assert.equal(f.service('collapse'), null);
	assert.equal(f.batches.length, count);
	assert.deepEqual(f.project().tracks.map(track => track.height), [114, 114]);
});
