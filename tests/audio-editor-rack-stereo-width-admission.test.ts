/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { createSoundscaperProjectRuntimeSelection } from '../src/soundscaper/editor-project-runtime-selection.ts';
import { createMemoryFfmpeg } from './helpers/audio-editor-controller-fixtures.js';
import { COPY, createAudioEditorController, createMemoryEngine, createProjectStore } from './helpers/audio-editor-controller-harness.js';
import { createEffect } from '../src/common/editor/effects.js';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { encodeWav } from '../src/common/editor/wav.js';

async function surroundController(context: TestContext) {
	type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
	const runtime = createSoundscaperProjectRuntimeSelection();
	const controller = createAudioEditorController(null, { headless: true, locale: 'en', copy: COPY, projectRuntime: runtime,
		sessionController: runtime.createSessionController(), store: createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: context.name }),
		engine: createMemoryEngine() as unknown as Options['engine'], ffmpeg: createMemoryFfmpeg() as unknown as Options['ffmpeg'] });
	context.after(async () => { await controller.dispose(); }); await controller.ready;
	await controller.actions.project.importFiles([new File([new Uint8Array(encodeWav(
		Array.from({ length: 6 }, () => new Float32Array(4800).fill(.125)), { sampleRate: 48000 }))], 'Surround.wav', { type: 'audio/wav' })]);
	return controller;
}

for (const operation of ['add', 'replace', 'enable'] as const) test(`manual ${operation} cannot install a known stereo-only rack on six-channel audio`, async context => {
	const controller = await surroundController(context);
	const trackId = controller.getSnapshot().selectedTrackId; assert.ok(trackId);
	const current = controller.actions.effects.add({ scope: 'track', trackId, type: operation === 'enable' ? 'reverb' : 'delay',
		options: { enabled: operation !== 'enable' } }); assert.equal(typeof current, 'string'); assert.ok(current);
	const before = controller.project, history = controller.getSnapshot().history.undoEntries.length;
	assert.throws(() => operation === 'add' ? controller.actions.effects.add({ scope: 'track', trackId, type: 'reverb' })
		: controller.actions.effects.update('track', trackId, current, operation === 'replace' ? { type: 'reverb' } : { enabled: true }), /support/iu);
	assert.deepEqual(controller.project, before);
	assert.equal(controller.getSnapshot().history.undoEntries.length, history);
	assert.ok(controller.actions.effects.add({ scope: 'track', trackId, type: 'lowpass' }), 'supported multichannel racks remain available');
});


for (const scope of ['track', 'master', 'group', 'send'] as const) test(`a loaded bypassed ${scope} rack permits safe edits and refuses unsupported activation`, async context => {
	const controller = await surroundController(context);
	const trackId = controller.getSnapshot().selectedTrackId; assert.ok(trackId);
	if (scope === 'group' || scope === 'send') controller.actions.mixer.addBus(scope, { id: 'wide' });
	const project = controller.project; assert.ok(project);
	const effect = createEffect('reverb', { id: 'imported-reverb' });
	const bypassed = { effectsActive: false, effects: [effect] };
	await controller.actions.project.open(createSoundscaperProject({ ...project, id: `bypassed-${scope}`, masterChannels: 6,
		tracks: project.tracks.map(track => scope === 'track' && track.id === trackId ? { ...track, ...bypassed } : track),
		master: scope === 'master' ? { ...project.master, ...bypassed } : project.master,
		mixer: { ...project.mixer,
			groups: project.mixer.groups.map(bus => scope === 'group' && bus.id === 'wide' ? { ...bus, channelCount: 6, ...bypassed } : bus),
			sends: project.mixer.sends.map(bus => scope === 'send' && bus.id === 'wide' ? { ...bus, channelCount: 6, ...bypassed } : bus) },
	}));
	const sourceId = scope === 'track' ? trackId : scope === 'master' ? null : 'wide';
	const before = controller.project; assert.ok(before);
	const updated = controller.actions.effects.update(scope, sourceId, effect.id, { params: { mix: .25 } });
	const owner = scope === 'track' ? updated.tracks.find(track => track.id === trackId) : scope === 'master' ? updated.master
		: (scope === 'group' ? updated.mixer?.groups : updated.mixer?.sends)?.find(bus => bus.id === 'wide');
	assert.ok(owner); assert.equal(Reflect.get(owner, 'effectsActive'), false);
	assert.equal(owner.effects?.[0]?.params.mix, .25);
	assert.deepEqual(controller.project?.sources, before.sources); assert.deepEqual(controller.project?.clips, before.clips);
	const inactive = controller.project, history = controller.getSnapshot().history.undoEntries.length;
	const activate = () => scope === 'track' ? controller.actions.track.update(trackId, { effectsActive: true })
		: scope === 'master' ? controller.actions.mixer.updateMaster({ effectsActive: true })
			: controller.actions.mixer.updateBus(scope, 'wide', { effectsActive: true });
	assert.throws(activate, /support/iu); assert.deepEqual(controller.project, inactive);
	assert.equal(controller.getSnapshot().history.undoEntries.length, history);
	controller.actions.effects.update(scope, sourceId, effect.id, { enabled: false });
	assert.doesNotThrow(activate, 'inactive unsupported processors do not block the remaining safe chain');
});
