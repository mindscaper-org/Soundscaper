/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import AudioEditorEffectsOverlay from '../src/common/editor/ui/inspector/AudioEditorEffectsOverlay.jsx';
import { SelectionEffectsDialog } from '../src/common/editor/ui/inspector/SelectionEffectsDialog.jsx';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createAudioClip, createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

async function fixture(owner: 'selection' | 'rack' = 'selection') {
	const dom = installReactTestDom();
	const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = globals.IS_REACT_ACT_ENVIRONMENT;
	const priorReact = Object.getOwnPropertyDescriptor(globalThis, 'React');
	globals.IS_REACT_ACT_ENVIRONMENT = true;
	Object.defineProperty(globalThis, 'React', { configurable: true, value: React });
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	let project = createProject('first');
	let generation = 1;
	const committed: Readonly<Record<string, unknown>>[] = [];
	const parameter = owner === 'rack' ? 'mix' : 'gainDb';
	const controller = {
		get project() { return project; },
		captureProjectGeneration(projectId: string) { return { projectId, generation }; },
		actions: { effects: {
			setSelectionParams(params: Readonly<Record<string, unknown>>) { committed.push(params); },
			update(_scope: string, _trackId: string, _effectId: string, changes: Readonly<{ params: Readonly<Record<string, unknown>> }>) { committed.push(changes.params); },
			setControlTrack() {}, cancelPreview() {}, previewSelection() {}, captureNoiseProfile() {},
			applySelection: async () => undefined,
			presets: { list: () => [], apply() {}, save() {}, import() {}, export() {}, delete() {} },
		} },
	};
	const render = async (id: string, gainDb: number, nextGeneration = generation) => {
		generation = nextGeneration;
		project = createProject(id, owner === 'rack' ? gainDb : undefined);
		const snapshot = { ready: true, project, selectedTrackId: 'voice', selectedClipId: 'clip',
			preferences: { editing: { applyEffectsToAllAudio: true } },
			effects: { selectionType: 'audacity-amplify', selectionParams: { gainDb, allowClipping: false },
				presets: [], controlTrackId: null, previewing: false, noiseProfileReady: false } };
		await act(async () => root.render(owner === 'selection'
			? <SelectionEffectsDialog isOpen controller={controller} snapshot={snapshot}
				copy={ENGLISH_COPY} fileService={null} onClose={() => undefined} />
			: <AudioEditorEffectsOverlay isOpen controller={controller} snapshot={snapshot}
				copy={ENGLISH_COPY} locale="en" fileService={null} onClose={() => undefined}
				trackId="voice" renderRack={false} selectedEffect={{ scope: 'track', id: 'effect' }}
				onSelectedEffectChange={() => undefined} />));
	};
	await render('first', owner === 'rack' ? .3 : 3);
	const input = () => {
		const field = dom.one(`[data-effect-param="${parameter}"]`).querySelector('.text-input__field');
		assert.ok(field); return field;
	};
	return { render, input, committed,
		async type(value: string) { await act(async () => reactProps(input()).onChange({ target: { value } })); },
		async blur() { await act(async () => reactProps(input()).onBlur()); },
		async dispose() {
			await act(async () => root.unmount()); globals.IS_REACT_ACT_ENVIRONMENT = priorAct;
			if (priorReact) Object.defineProperty(globalThis, 'React', priorReact); else Reflect.deleteProperty(globalThis, 'React');
			dom.restore();
		},
	};
}

function createProject(id: string, mix?: number) {
	return createSoundscaperProject({ id, sources: [createAudioSource({ id: 'source', sampleRate: 48_000, frameCount: 48_000, channelCount: 1 })],
		clips: [createAudioClip({ id: 'clip', sourceId: 'source', durationFrames: 48_000, sourceDurationFrames: 48_000 })],
		tracks: [createAudioTrack({ id: 'voice', clipIds: ['clip'], ...(mix === undefined ? {} : { effects: [{ id: 'effect', type: 'delay', enabled: true, params: { time: .1, feedback: .2, mix } }] }) })] });
}

for (const sameId of [false, true]) test(`numeric effect drafts retire with ${sameId ? 'reactivated' : 'different'} project ownership`, async () => {
	const mounted = await fixture();
	try {
		await mounted.type('6');
		await mounted.render(sameId ? 'first' : 'second', 9, 2);
		assert.equal(mounted.input().value, '9');
		await mounted.blur();
		assert.equal(mounted.committed.at(-1)?.gainDb, 9);
	} finally { await mounted.dispose(); }
});

test('ordinary same-project default publication keeps the edited effect draft', async () => {
	const mounted = await fixture();
	try {
		await mounted.type('6');
		await mounted.render('first', 9);
		assert.equal(mounted.input().value, '6');
		await mounted.blur();
		assert.equal(mounted.committed.at(-1)?.gainDb, 6);
	} finally { await mounted.dispose(); }
});

for (const sameId of [false, true]) test(`rack numeric drafts retire with ${sameId ? 'reactivated' : 'different'} project ownership`, async () => {
	const mounted = await fixture('rack');
	try {
		await mounted.type('0.6');
		await mounted.render(sameId ? 'first' : 'second', .9, 2);
		assert.equal(mounted.input().value, '0.9');
		await mounted.blur();
		assert.equal(mounted.committed.at(-1)?.mix, .9);
	} finally { await mounted.dispose(); }
});
