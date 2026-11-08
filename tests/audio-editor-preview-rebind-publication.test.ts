/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { clipFixture, createHarness, createPreviewEngine, projectFixture } from './helpers/project-bin-service-harness.ts';
import { deferred, waitFor } from './helpers/async-test-control.ts';

test('a Project Bin audition publishes its existing engine resuming after output replacement', async () => {
	const engine = createPreviewEngine(Promise.resolve());
	const fixture = createHarness(projectFixture({ projectBinClips: [clipFixture({ id: 'bin', sourceId: 'audio' })] }), { previewEngine: engine });
	await fixture.service.playPauseProjectBinClip('bin');
	engine.emit('paused');
	assert.equal(fixture.preview?.state, 'paused');
	engine.emit('playing');
	assert.equal(fixture.preview?.state, 'playing');
	await fixture.service.stopProjectBinPreview();
	engine.emit('playing');
	assert.equal(fixture.preview, null, 'a stopped audition cannot be resurrected by a stray event');
	await fixture.service.dispose();
});

test('a stale playing notification cannot override the actual paused preview engine', async () => {
	const engine = createPreviewEngine(Promise.resolve());
	const stop = engine.stop?.bind(engine);
	assert.ok(stop);
	let state = 'stopped';
	const fixture = createHarness(projectFixture({ projectBinClips: [clipFixture({ id: 'bin', sourceId: 'audio' })] }), {
		createPreviewEngine: ({ onState }) => {
			engine.setOnState(onState);
			return { ...engine, getState: () => ({ state }),
				async play() { state = 'playing'; await engine.play(); },
				pause() { state = 'paused'; engine.pause(); },
				stop() { state = 'stopped'; stop(); } };
		},
	});
	await fixture.service.playPauseProjectBinClip('bin');
	await fixture.service.playPauseProjectBinClip('bin');
	engine.emit('playing');
	assert.equal(fixture.preview?.state, 'paused');
	state = 'playing'; engine.emit('playing');
	assert.equal(fixture.preview?.state, 'paused', 'an actual late start still cannot override the user Pause');
	assert.equal(state, 'paused', 'the late voice is paused too');
	await fixture.service.dispose();
});

test('Pause while a bin audition initially warms cannot be undone by its late playing event', async () => {
	const ready = deferred<void>(), entered = deferred<void>();
	let state = 'ready', onState: (value: string) => void = () => {};
	const fixture = createHarness(projectFixture({ projectBinClips: [clipFixture({ id: 'bin', sourceId: 'audio' })] }), {
		createPreviewEngine: options => {
			onState = options.onState;
			return { loadProject() {}, getState: () => ({ state }),
				async play() { entered.resolve(); await ready.promise; state = 'playing'; onState(state); },
				pause() { state = 'paused'; onState(state); }, stop() { state = 'stopped'; onState(state); } };
		},
	});
	const start = fixture.service.playPauseProjectBinClip('bin');
	const stopped = assert.rejects(start, error => error instanceof Error && error.name === 'AbortError');
	await entered.promise; await waitFor(() => fixture.preview?.state === 'playing', 'optimistic audition state');
	await fixture.service.playPauseProjectBinClip('bin'); ready.resolve(); await stopped;
	assert.equal(fixture.preview?.state, 'paused'); assert.equal(state, 'paused');
	await fixture.service.dispose();
});
