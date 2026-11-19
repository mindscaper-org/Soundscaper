/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import React, { act, useSyncExternalStore } from 'react';
import { createMemoryEngine } from './helpers/audio-editor-controller-harness.js';
import { createEffect } from '../src/common/editor/effects.js';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import AudioEditorEffectsOverlay from '../src/common/editor/ui/inspector/AudioEditorEffectsOverlay.jsx';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { controllerSession } from './helpers/soundscaper-controller-session.ts';
import { mountControllerDataDom } from './helpers/controller-data-dom.ts';
import { reactProps, ReactTestElement } from './helpers/react-test-dom.ts';
import { assertAudioProjectArchivePcm } from './helpers/audio-project-archive-pcm-custody.ts';
import { assertPcmChannelsEqual } from './helpers/assert-pcm-samples.ts';

/** The browser's exact RIFF16 tuple: only its fourth-index channel carries a 440 Hz signal. */
function originalSurround() {
	const bytes = Buffer.alloc(44 + 4800 * 6 * 2), pcm = Array.from({ length: 6 }, () => new Float32Array(4800));
	bytes.write('RIFF', 0); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVEfmt ', 8);
	bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(6, 22);
	bytes.writeUInt32LE(48000, 24); bytes.writeUInt32LE(48000 * 12, 28); bytes.writeUInt16LE(12, 32);
	bytes.writeUInt16LE(16, 34); bytes.write('data', 36); bytes.writeUInt32LE(bytes.length - 44, 40);
	for (let frame = 0; frame < 4800; frame += 1) {
		const sample = Math.round(Math.sin(2 * Math.PI * 440 * frame / 48000 + Math.PI / 3) * .5 * 32767);
		bytes.writeInt16LE(sample, 44 + (frame * 6 + 4) * 2); pcm[4]![frame] = (sample || 0) / 32768;
	}
	return { file: new File([bytes], 'Surround.wav', { type: 'audio/wav' }), pcm };
}

async function surroundController(context: TestContext) {
	type Options = NonNullable<Parameters<typeof controllerSession>[1]>;
	const engine = { ...createMemoryEngine(), async decodeAudioData() { throw new Error('Surround input requires the shipping RIFF decoder.'); } };
	const session = await controllerSession(context, { engine: engine as unknown as Options['engine'],
		engineFactory: () => { throw new Error('Rack eligibility must not substitute native DSP output.'); } });
	const original = originalSurround();
	await session.controller.actions.project.importFiles([original.file]);
	return { ...session, original };
}

type Controller = Awaited<ReturnType<typeof controllerSession>>['controller'];
function LiveRack({ controller, trackId }: Readonly<{ controller: Controller; trackId: string }>) {
	const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
	return React.createElement(AudioEditorEffectsOverlay, { isOpen: true, controller, snapshot, copy: ENGLISH_COPY,
		locale: 'en', trackId, renderDialogs: false, autoFocusOnOpen: false, selectedEffect: undefined,
		onSelectedEffectChange: undefined, fileService: undefined, onClose: () => undefined });
}

for (const operation of ['add', 'replace', 'enable'] as const) test(`manual ${operation} cannot install a known stereo-only rack on six-channel audio`, async context => {
	const { controller, store, original } = await surroundController(context);
	const trackId = controller.getSnapshot().selectedTrackId; assert.ok(trackId);
	if (operation === 'add') {
		const before = structuredClone(controller.project), history = structuredClone(controller.getSnapshot().history);
		const source = controller.project?.sources[0]; assert.ok(source?.kind === 'audio');
		assert.deepEqual([source.name, source.sampleRate, source.frameCount, source.channelCount], ['Surround.wav', 48000, 4800, 6]);
		const fixture = mountControllerDataDom();
		Object.assign(window, { innerWidth: 1200, innerHeight: 800 });
		const previousClassList = Object.getOwnPropertyDescriptor(ReactTestElement.prototype, 'classList');
		Object.defineProperty(ReactTestElement.prototype, 'classList', { configurable: true,
			get(this: ReactTestElement) { return { contains: (name: string) => (this.getAttribute('class') ?? '').split(/\s+/u).includes(name) }; } });
		try {
			await fixture.render(React.createElement(LiveRack, { controller, trackId }));
			const trigger = fixture.dom.one('.effects-stack-header__add-button');
			await act(async () => { reactProps(trigger).onClick!({ currentTarget: trigger }); });
			const item = (label: string) => { const node = fixture.dom.container.querySelectorAll('[role="menuitem"]').find(row => row.textContent === label); assert.ok(node, label); return node; };
			assert.equal(item('Reverb').hasAttribute('disabled'), true); assert.equal(item('Feedback delay').hasAttribute('disabled'), false);
			assert.equal(fixture.dom.container.querySelectorAll('[role="alert"]').length, 0);
			assert.deepEqual(controller.project, before); assert.deepEqual(controller.getSnapshot().history, history);
			await act(async () => { await controller.actions.project.flush(); });
			await assertAudioProjectArchivePcm(context, store, controller.project, (name, channels) => {
				assert.equal(name, 'Surround.wav'); assertPcmChannelsEqual(channels, original.pcm, 'all six original RIFF16 channels');
			});
		} finally {
			try { await fixture.dispose(); } finally {
				if (previousClassList) Object.defineProperty(ReactTestElement.prototype, 'classList', previousClassList);
				else Reflect.deleteProperty(ReactTestElement.prototype, 'classList');
			}
		}
	}
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
	const { controller } = await surroundController(context);
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
