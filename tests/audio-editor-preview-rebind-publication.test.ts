/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { clipFixture, createHarness, createPreviewEngine, projectFixture } from './helpers/project-bin-service-harness.ts';

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
	assert.equal(fixture.preview?.state, 'playing');
	await fixture.service.dispose();
});
