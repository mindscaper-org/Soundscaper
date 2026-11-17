/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { EditorProjectGeneration } from '../src/common/editor/controller/shared/lifecycle.ts';
import { createEffect } from '../src/common/editor/effects.js';
import type { MixerEdgeV21 } from '../src/common/editor/mixer-graph-v21.ts';
import { createSoundscaperAudioFreezeActions, type SoundscaperAudioFreezeActionsOptions } from '../src/soundscaper/editor-audio-track-freeze-actions.ts';
import { assertCurrentSoundscaperFreezeProject, captureSoundscaperFreezeProject } from '../src/soundscaper/editor-audio-track-freeze-currency.ts';
import { createSoundscaperAudioTrackFreezePlaybackService } from '../src/soundscaper/editor-audio-track-freeze-playback.ts';
import { planFreezeRange, renderFreezeBody } from '../src/soundscaper/editor-audio-track-freeze-render.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { applySoundscaperProjectCommand } from '../src/soundscaper/editor-project-commands.ts';
import { soundscaperAudioTrackFreezeRequirementId } from '../src/soundscaper/editor-project-feature-requirements.ts';
import { createSoundscaperPlaybackProjectService } from '../src/soundscaper/editor-project-playback.ts';
import { createSoundscaperEphemeralProjectStore } from '../src/soundscaper/editor-project-store.ts';
import { deferred } from './helpers/async-test-control.ts';

const RATE = 48_000;
const WIDTH = 1;
const FRAMES = 16;

function projectFixture(options: Parameters<typeof createSoundscaperProject>[0] = {}) {
	return createSoundscaperProject({
		id: 'freeze-boundaries',
		sources: [{ id: 'source', storageKey: 'source', frameCount: FRAMES, sampleRate: RATE, channelCount: WIDTH }],
		clips: [{ id: 'clip', sourceId: 'source', durationFrames: FRAMES }],
		tracks: [{ id: 'voice', type: 'audio', clipIds: ['clip'], effects: [createEffect('limiter', { id: 'limiter' })] },
			{ id: 'guide', type: 'audio', clipIds: [] }],
		...options,
	});
}

async function fixture(context: TestContext, project = projectFixture(), options: SoundscaperAudioFreezeActionsOptions = {}) {
	const store = createSoundscaperEphemeralProjectStore();
	const source = project.sources[0]!;
	await store.writeAudioBuffer(source.storageKey, { sampleRate: RATE, numberOfChannels: WIDTH, length: FRAMES,
		getChannelData: () => new Float32Array(FRAMES).fill(.25) }, source);
	const playback = createSoundscaperAudioTrackFreezePlaybackService(createSoundscaperPlaybackProjectService(), store);
	let current = project;
	const generation = new EditorProjectGeneration();
	generation.activate(current.id);
	const binding = createSoundscaperAudioFreezeActions({ store, playback }, {
		get project() { return current; },
		captureProjectGeneration: id => generation.capture(id),
		assertProjectGeneration: token => generation.assertCurrent(token),
		actions: { edit: { commit(command) { current = applySoundscaperProjectCommand(current, command); return current; } } },
	}, { createId: kind => `new-${kind}`, createRenderEngine: () => ({
		loadProject() {},
		renderTrack: (_id, options) => Promise.resolve({ channels: [new Float32Array(Number(options?.outputFrames)).fill(.25)] }),
		async dispose() {},
	}), ...options });
	context.after(async () => { await binding.dispose(); playback.dispose(); await store.close(); });
	return { store, playback, binding, get current() { return current; }, set current(project) { current = project; }, generation };
}

function addSidechain(project: ReturnType<typeof projectFixture>) {
	const edge: MixerEdgeV21 = {
		id: 'external-key', kind: 'sidechain', source: { kind: 'track', id: 'guide' },
		destination: { kind: 'effect-sidechain', strip: { kind: 'track', id: 'voice' }, effectId: 'limiter' },
		position: 'pre-fader', level: 1, enabled: true, channelMap: [],
	};
	return applySoundscaperProjectCommand(project, { type: 'mixer-graph/set', expected: project.mixer,
		mixer: { ...project.mixer, edges: [...project.mixer.edges, edge] } });
}

test('a freeze that was preparing native state cannot capture another open project with the same track ID', async context => {
	const started = deferred<void>(), release = deferred<void>();
	const state = await fixture(context, projectFixture(), { async prepareProject() { started.resolve(); await release.promise; } });
	const freezing = state.binding.actions.freeze('voice');
	await started.promise;
	state.current = projectFixture({ id: 'different-open-project' });
	state.generation.activate(state.current.id);
	release.resolve();
	await assert.rejects(freezing, /project changed/iu);
	assert.equal(state.current.tracks[0]?.audioFreeze, undefined);
	assert.equal(await state.store.getSourceMetadata('new-source'), null);
});

test('changing an immutable storage binding with no declared digest invalidates the in-flight freeze ticket', () => {
	let current = projectFixture();
	const controller = { get project() { return current; } };
	const ticket = captureSoundscaperFreezeProject(controller, current, 'voice');
	current = applySoundscaperProjectCommand(current, { type: 'source/rewrite-media', sourceId: 'source',
		changes: { storageKey: 'new-binding', frameCount: FRAMES }, clips: [{ clipId: 'clip', sourceStartFrame: 0 }] });
	assert.equal(current.sources[0]?.storageKey, 'new-binding');
	assert.throws(() => assertCurrentSoundscaperFreezeProject(controller, ticket), /project changed/iu);
});

test('a bypassed keyed effect can freeze without rendering its detector track', async context => {
	const original = applySoundscaperProjectCommand(addSidechain(projectFixture()), { type: 'track/update', trackId: 'voice', changes: { effectsActive: false } });
	const state = await fixture(context, original);
	await state.binding.actions.freeze('voice');
	assert.ok(state.current.tracks[0]?.audioFreeze);
	assert.ok(state.current.mixer.edges.some(({ id }) => id === 'external-key'));
});

test('adding a live sidechain makes a prior freeze stale and prevents it from masking the new detector', async context => {
	const state = await fixture(context);
	const editing = state.current;
	const edited = addSidechain(editing);
	const ticket = captureSoundscaperFreezeProject({ project: editing }, editing, 'voice');
	assert.throws(() => assertCurrentSoundscaperFreezeProject({ project: edited }, ticket), /project changed/iu);
	await state.binding.actions.freeze('voice');
	const before = state.current;
	assert.equal(state.playback.getFreezeStatus(before, 'voice'), 'fresh');
	state.current = createSoundscaperProject({ ...before, mixer: edited.mixer });
	assert.equal(state.playback.getFreezeStatus(state.current, 'voice'), 'stale');
	assert.ok(state.playback.projectForPlayback(state.current).project.clips.some(({ id }) => id === 'clip'));
});

test('a stale track with a new sidechain can still discard its freeze without changing the mixer', async context => {
	const state = await fixture(context);
	const { mixer } = addSidechain(state.current);
	await state.binding.actions.freeze('voice');
	state.current = createSoundscaperProject({ ...state.current, mixer });
	await state.binding.actions.unfreeze('voice');
	assert.equal(state.current.tracks[0]?.audioFreeze, undefined);
	assert.ok(state.current.mixer.edges.some(({ id }) => id === 'external-key'));
	assert.equal(state.current.clips[0]?.id, 'clip');
});

test('an unrelated clip with a collision in the projected ID namespace survives playback and delivery', async context => {
	const collision = `${soundscaperAudioTrackFreezeRequirementId('voice')}clip`;
	const original = projectFixture({ projectBin: { clips: [{ id: collision, sourceId: 'source', durationFrames: FRAMES }] } });
	const state = await fixture(context, original);
	await state.binding.actions.freeze('voice');
	assert.equal(state.current.projectBin.clips[0]?.id, collision);
	for (const projection of [
		state.playback.projectForPlayback(state.current), state.playback.projectForAudioRenderedFallbackDelivery(state.current),
	]) {
		assert.equal(projection.project.projectBin.clips[0]?.id, collision);
		assert.equal(projection.project.clips[0]?.sourceId, 'new-source');
		assert.notEqual(projection.project.clips[0]?.id, collision);
	}
});

test('freeze rejects incorrectly widened offline PCM instead of changing the track channel geometry', async context => {
	const project = projectFixture(), state = await fixture(context, project);
	const range = planFreezeRange(project, 'voice');
	await assert.rejects(renderFreezeBody(state.store, { project }, () => ({
		loadProject() {}, renderTrack: () => Promise.resolve({ channels: [new Float32Array(range.renderFrameCount), new Float32Array(range.renderFrameCount)] }), async dispose() {},
	}), { project, trackId: 'voice', sampleRate: RATE, ...range }), /geometry|width/iu);
});

test('freeze rejects an AudioBuffer from a different clock', async context => {
	const project = projectFixture(), state = await fixture(context, project);
	const range = planFreezeRange(project, 'voice');
	const foreignClock = { numberOfChannels: WIDTH, sampleRate: 44_100, length: range.renderFrameCount,
		getChannelData: () => new Float32Array(range.renderFrameCount) } as AudioBuffer;
	await assert.rejects(renderFreezeBody(state.store, { project }, () => ({
		loadProject() {}, renderTrack: () => Promise.resolve(foreignClock), async dispose() {},
	}), { project, trackId: 'voice', sampleRate: RATE, ...range }), /sample rate|clock|geometry/iu);
});

test('a reopened project stops using its previously verified freeze if the stored render has disappeared', async context => {
	const state = await fixture(context);
	await state.binding.actions.freeze('voice');
	const original = state.current;
	await state.playback.prepareProjectForActivation?.(original);
	assert.equal(state.playback.getFreezeStatus(original, 'voice'), 'fresh');
	const generation = await state.store.getSourceMetadata('new-source');
	assert.ok(generation);
	assert.equal(await state.store.discardSourceIfCurrent(generation), true);
	const reopened = structuredClone(original);
	await state.playback.prepareProjectForActivation?.(reopened);
	assert.equal(state.playback.getFreezeStatus(reopened, 'voice'), 'unknown');
	assert.deepEqual(state.playback.projectForPlayback(reopened).requiredAudioSourceIds, []);
	assert.equal(state.playback.projectForPlayback(reopened).project.clips[0]?.sourceId, 'source');
});
