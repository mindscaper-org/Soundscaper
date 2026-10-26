/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createFitTrackHeights } from '../src/common/editor/controller/transport/internal/fit-track-heights.ts';

function fixture() {
	let project = { tracks: [{ id: 'a', height: 220 }, { id: 'b', height: 160 }] };
	let blocked = false;
	const state = { autoFitTrackHeight: false, visibleTrackHeights: {} as Record<string, number> };
	const batches: unknown[] = [];
	const fit = createFitTrackHeights({
		getProject: () => project, state, editingBlocked: () => blocked, publishProjectState() {},
		commit(command) {
			batches.push(command);
			project = { ...project, tracks: project.tracks.map(track => ({ ...track,
				height: command.commands.find(item => item.trackId === track.id)?.changes.height ?? track.height })) };
			state.visibleTrackHeights = {};
			return project;
		},
	});
	return { fit, state, batches, project: () => project, setBlocked(value: boolean) { blocked = value; } };
}

test('fit divides the available viewport or reserves the other tracks for a single-track fit', () => {
	const f = fixture();
	f.fit(['a'], 600);
	assert.deepEqual(f.project().tracks.map(track => track.height), [440, 160]);
	f.fit(undefined, 301);
	assert.deepEqual(f.project().tracks.map(track => track.height), [150, 150]);
	f.fit(undefined, 10);
	assert.deepEqual(f.project().tracks.map(track => track.height), [40, 40]);
});

test('single-track fitting freezes other displayed heights and disables automatic fitting atomically', () => {
	const f = fixture();
	f.state.autoFitTrackHeight = true;
	f.state.visibleTrackHeights = { a: 280, b: 180 };
	f.fit(['a'], 600);
	assert.deepEqual(f.project().tracks.map(track => track.height), [420, 180]);
	assert.equal(f.state.autoFitTrackHeight, false);
	assert.equal(f.batches.length, 1);
});

test('blocked commands preserve heights and invalid viewports fall back to a finite default', () => {
	const f = fixture();
	f.setBlocked(true);
	assert.equal(f.fit(), null);
	assert.equal(f.batches.length, 0);
	f.setBlocked(false);
	for (const invalid of [undefined, NaN, Infinity, -20]) {
		f.fit(['a'], invalid);
		assert.deepEqual(f.project().tracks.map(track => track.height), [300, 160]);
	}
});
