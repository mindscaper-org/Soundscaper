/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createMacroViewService } from '../src/common/editor/controller/effects/internal/macro/macro-view-service.ts';

function harness() {
	let project = { id: 'original', tracks: [
		{ id: 'audio', type: 'audio', height: 114, displayMode: 'waveform' },
		{ id: 'video', type: 'video', height: 120, hidden: false },
	] };
	const state = { pixelsPerSecond: 120, autoFitTrackHeight: true, timelineView: 'waveform', allowBelowProjectFitZoom: false };
	const view = createMacroViewService({ getProject: () => project, state,
		setZoom: (value, allowBelowProjectFit) => { state.pixelsPerSecond = value; state.allowBelowProjectFitZoom = allowBelowProjectFit; },
		setView: value => { state.timelineView = value; },
		setAutoFitTrackHeight: value => { state.autoFitTrackHeight = value; },
		zoom: action => { state.pixelsPerSecond = action === 'fit' ? 50 : state.pixelsPerSecond * (action === 'in' ? 2 : .5); },
		updateTracks: updates => {
			for (const update of updates) Object.assign(project.tracks.find(track => track.id === update.id)!, update.changes);
		},
	});
	return { view, state, switchProject: () => { project = { ...project, id: 'successor' }; state.pixelsPerSecond = 99; } };
}

test('view snapshots restore audio display, video visibility and track heights without a DOM viewport', async () => {
	const { view, state } = harness();
	const initial = view.snapshot();
	assert.ok(!('scrollX' in initial));
	await view.set({ view: 'spectrogram', tracks: [{ id: 'audio', height: 240, displayMode: 'multiview' }, { id: 'video', hidden: true }] });
	assert.equal(state.autoFitTrackHeight, false);
	assert.deepEqual(view.snapshot().tracks, [
		{ id: 'audio', height: 240, displayMode: 'multiview' },
		{ id: 'video', height: 120, hidden: true },
	]);
	await view.set(initial);
	assert.deepEqual(view.snapshot(), initial);
});

test('view admission validates every track and field before changing zoom or presentation', async () => {
	const { view } = harness();
	const initial = view.snapshot();
	for (const value of [
		null, [], { pixelsPerSecond: NaN }, { pixelsPerSecond: 0 }, { autoFitTrackHeight: 1 },
		{ tracks: [{ id: 'audio', height: 50.5 }] }, { tracks: [{ id: 'audio', height: 39 }] },
		{ tracks: [{ id: 'audio', hidden: true }] }, { tracks: [{ id: 'video', hidden: 1 }] },
		{ tracks: [{ id: 'audio' }, { id: 'audio' }] }, { tracks: [{ id: 'video', displayMode: 'waveform' }] },
		{ pixelsPerSecond: 1000, tracks: [{ id: 'audio', height: 200 }, { id: 'missing', height: 200 }] },
		{ pixelsPerSecond: 1000, scrollX: 10 }, { tracks: 'audio' },
	]) {
		await assert.rejects(view.set(value));
		assert.deepEqual(view.snapshot(), initial);
	}
	await assert.rejects(view.zoom('selection'), /in, out, or fit/u);
});

test('transient rollback restores the prior zoom policy as well as zoom and automatic height fitting', async () => {
	const { view, state } = harness();
	const saved = view.captureTransient();
	await view.set({ pixelsPerSecond: 1000, autoFitTrackHeight: false });
	assert.equal(state.allowBelowProjectFitZoom, true);
	await view.restoreTransient(saved);
	assert.deepEqual(state, { pixelsPerSecond: 120, autoFitTrackHeight: true, timelineView: 'waveform', allowBelowProjectFitZoom: false });
});

test('a delayed scroll cannot affect a successor project and old cleanup cannot detach a new viewport', async () => {
	const { view, state, switchProject } = harness();
	let release!: () => void;
	const gate = new Promise<void>(resolve => { release = resolve; });
	let writes = 0;
	const unbindOld = view.bindViewport({ read: () => ({ scrollX: 0, scrollY: 0 }), write: async (_position, assertCurrent) => {
		await gate; assertCurrent(); writes++;
	} });
	const attempt = view.set({ pixelsPerSecond: 1000, scrollX: 300 });
	switchProject();
	const unbindNew = view.bindViewport({ read: () => ({ scrollX: 42, scrollY: 3 }), write: async () => undefined });
	unbindOld(); release();
	await assert.rejects(attempt, { name: 'AbortError' });
	assert.equal(writes, 0);
	assert.equal(state.pixelsPerSecond, 99);
	assert.equal(view.snapshot().scrollX, 42);
	unbindNew(); unbindNew();
	assert.ok(!('scrollX' in view.snapshot()));
});

test('rollback cannot restore over a newer program, including while its scroll restoration is waiting', async () => {
	const { view, state } = harness();
	const older = view.captureTransient();
	await view.set({ pixelsPerSecond: 1000 });
	view.captureTransient();
	await view.restoreTransient(older);
	assert.equal(state.pixelsPerSecond, 1000);
	let release!: () => void;
	const gate = new Promise<void>(resolve => { release = resolve; });
	let writes = 0;
	view.bindViewport({ read: () => ({ scrollX: 0, scrollY: 0 }), write: async (_position, assertCurrent) => {
		await gate; assertCurrent(); writes++;
	} });
	const captured = view.captureTransient();
	const restoring = view.restoreTransient(captured);
	view.captureTransient(); release();
	await assert.rejects(restoring, { name: 'AbortError' });
	assert.equal(writes, 0);
});
