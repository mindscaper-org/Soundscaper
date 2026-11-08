/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { SelectionEffectsDialog } from '../src/common/editor/ui/inspector/SelectionEffectsDialog.jsx';
import { createSelectionEffectExecutionService } from '../src/common/editor/controller/effects/internal/effect-execution-service.ts';
import { createEffectSelectionService } from '../src/common/editor/controller/effects/effect-selection-service.ts';
import { createSourceEditorEffects } from '../src/common/editor/controller/effects/internal/source-editor-effects.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createAudioClip, createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { projectForRuntimeConsumers } from '../src/common/editor/project-current-runtime.ts';
import { resolveEditingSelection } from '../src/common/editor/commands/editing-selection-authority.ts';
import { normalizeAudioSelectionEffectParams } from '../src/common/editor/effects.js';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

function fixture() {
	const source = createAudioSource({ id: 'source', channelCount: 1, frameCount: 48_000, sampleRate: 48_000 });
	const clips = ['a', 'b'].map(id => createAudioClip({ id: `clip-${id}`, sourceId: source.id,
		timelineStartFrame: 0, durationFrames: 48_000, sourceDurationFrames: 48_000 }));
	const make = (locked: readonly string[], selection: ReturnType<typeof createSoundscaperProject>['selection'] | null) => {
		const tracks = ['a', 'b'].map(id => createAudioTrack({ id, name: id, locked: locked.includes(id), clipIds: [`clip-${id}`] }));
		return projectForRuntimeConsumers({ ...createSoundscaperProject({ id: 'effects', sources: [source], tracks, clips, selection: selection ?? { startFrame: 0, endFrame: 0 } }), sources: [source], tracks, clips });
	};
	let project = make([], null);
	const parameters: Record<string, Readonly<Record<string, unknown>>> = {};
	const state = { audacityEffectParams: parameters, selectedTrackId: 'a', selectedClipId: 'clip-a', audacityEffectType: 'audacity-amplify',
		preferences: { editing: { applyEffectsToAllAudio: false } } };
	const sourceEditor = createSourceEditorEffects({ getProject: () => project,
		loadSourceBuffer: async () => null, publishDocumentSnapshot() {} });
	const planner = createEffectSelectionService({ state, getProject: () => project, sourceTarget: sourceEditor.target,
		activeSelection: () => project.selection && project.selection.endFrame > project.selection.startFrame ? project.selection : null,
		resolveEditingSelection,
		audacitySelectionChannelCount: (_project, trackId, startFrame, endFrame) => project.tracks.find(track => track.id === trackId)?.clipIds.some(id =>
			project.clips.some(clip => clip.id === id && clip.timelineStartFrame < endFrame && clip.timelineStartFrame + clip.durationFrames > startFrame)) ? 1 : 0,
		audioTrackChannelCount: () => 1, selectedTracksTimeRange: () => null, projectSampleRate: () => project.sampleRate,
		editingBlocked: () => false, setSelection: (startFrame, endFrame, details) => ({ selection: { startFrame, endFrame, ...details } }),
		copy: { audioTrackRequired: '', maximumFrequency: '', minimumFrequency: '', parameterRangeError: '', spectralEffectLengthChanging: '', timeSelectionRequired: '', v2Required: '' },
	});
	const service = createSelectionEffectExecutionService({ state, audacityEffectTargets: planner.audacityEffectTargets,
		normalizeAudioSelectionEffectParams,
		currentAudacityEffectParams: (type: string = state.audacityEffectType) => parameters[type] ??= {},
		AUDIO_SELECTION_EFFECT_DEFINITIONS: { 'audacity-amplify': {}, 'audacity-repeat': { lengthChanging: true }, 'multi-tap-delay': {} },
	});
	return { state, service, sourceEditor, get project() { return project; },
		set(locked: readonly string[], selection: typeof project.selection | null = null) { project = make(locked, selection); },
		params(next: Readonly<Record<string, unknown>>) { parameters[state.audacityEffectType] = next; },
	};
}

for (const scope of ['focused clip', 'unfocused selected clip', 'selected time', 'all audio', 'source overrides locked main', 'source overrides unlocked main'] as const) {
	test(`effect mutation admission follows ${scope}`, () => {
		const f = fixture();
		if (scope === 'focused clip') f.set(['a']);
		if (scope === 'unfocused selected clip') f.set(['b'], { ...f.project.selection, startFrame: 0, endFrame: 0, trackIds: ['a', 'b'], clipIds: ['clip-a', 'clip-b'] });
		if (scope === 'selected time') f.set(['b'], { ...f.project.selection, startFrame: 0, endFrame: 24_000, trackIds: ['a', 'b'] });
		if (scope === 'all audio') { f.state.selectedClipId = ''; f.state.preferences.editing.applyEffectsToAllAudio = true; f.set(['b']); }
		if (scope === 'source overrides locked main') { f.set(['a']); f.sourceEditor.setSourceSelection({ clipId: 'clip-b', startFrame: 100, endFrame: 1000 }); }
		if (scope === 'source overrides unlocked main') { f.set(['b']); f.sourceEditor.setSourceSelection({ clipId: 'clip-b', startFrame: 100, endFrame: 1000 }); }
		assert.equal(f.service.readSelectionTargetLocked(), scope !== 'source overrides locked main');
		f.sourceEditor.setSourceSelection(null); f.set([]);
		assert.equal(f.service.readSelectionTargetLocked(), false, 'unlocking the actual target enables Apply');
	});
}

test('unrelated locked tracks do not block selected clips', () => {
	const f = fixture(); f.set(['b']);
	assert.equal(f.service.readSelectionTargetLocked(), false);
});

test('empty selected lanes participate only when an effect changes their time', () => {
	const f = fixture(); f.state.selectedClipId = '';
	f.set(['b'], { ...f.project.selection, startFrame: 96_000, endFrame: 144_000, trackIds: ['a', 'b'] });
	assert.equal(f.service.readSelectionTargetLocked(), false);
	f.state.audacityEffectType = 'audacity-repeat';
	assert.equal(f.service.readSelectionTargetLocked(), true);
	f.state.audacityEffectType = 'multi-tap-delay'; f.params({ duration: 'keep', mix: .5 });
	assert.equal(f.service.readSelectionTargetLocked(), false);
	f.params({ duration: 'extend', mix: .5 });
	assert.equal(f.service.readSelectionTargetLocked(), true);
});

test('locked Apply is disabled without losing Preview, presets, Cancel or a later unlocked Apply', async () => {
	const f = fixture(), dom = installReactTestDom();
	const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = globals.IS_REACT_ACT_ENVIRONMENT, priorReact = Object.getOwnPropertyDescriptor(globalThis, 'React');
	globals.IS_REACT_ACT_ENVIRONMENT = true; Object.defineProperty(globalThis, 'React', { configurable: true, value: React });
	const root = createRoot(dom.container as unknown as Element);
	let applies = 0, previews = 0, closes = 0;
	const controller = { actions: { effects: {
		readSelectionTargetLocked: f.service.readSelectionTargetLocked,
		setSelectionParams() {}, setControlTrack() {}, cancelPreview() {}, cancelSelection() {},
		previewSelection: async () => { previews++; }, applySelection: async () => { applies++; },
		presets: { list: () => [], apply() {}, save() {}, import() {}, export() {}, delete() {} },
	} } };
	const render = async () => act(async () => root.render(<SelectionEffectsDialog isOpen controller={controller}
		snapshot={{ ready: true, project: f.project, selectedTrackId: 'a', selectedClipId: 'clip-a',
			effects: { selectionType: 'audacity-amplify', selectionParams: { gainDb: 3, allowClipping: false }, presets: [] } }}
		copy={ENGLISH_COPY} fileService={null} onClose={() => { closes++; }} />));
	const button = (label: string) => { const result = dom.container.querySelectorAll('button').find(node => node.textContent === label); assert.ok(result); return result; };
	const click = async (label: string) => act(async () => { await reactProps(button(label)).onClick({}); });
	try {
		await render();
		const staleApply = reactProps(button(ENGLISH_COPY.applyAudacityEffect)).onClick;
		f.set(['a']); await render();
		assert.equal(button(ENGLISH_COPY.applyAudacityEffect).hasAttribute('disabled'), true);
		assert.equal(button(ENGLISH_COPY.previewEffect).hasAttribute('disabled'), false);
		assert.equal(button(ENGLISH_COPY.cancel).hasAttribute('disabled'), false);
		assert.ok(dom.one('[data-effect-presets]').querySelectorAll('button').some(node => !node.hasAttribute('disabled')), 'nonmutating preset controls remain available');
		await act(async () => { await staleApply({}); });
		await click(ENGLISH_COPY.applyAudacityEffect);
		assert.equal(applies, 0); assert.equal(closes, 0);
		await click(ENGLISH_COPY.previewEffect); assert.equal(previews, 1);
		f.set([]); await render(); await click(ENGLISH_COPY.applyAudacityEffect);
		assert.equal(applies, 1); assert.equal(closes, 1);
		f.set(['a']); await render(); await click(ENGLISH_COPY.cancel); assert.equal(closes, 2);
	} finally {
		await act(async () => root.unmount()); globals.IS_REACT_ACT_ENVIRONMENT = priorAct;
		if (priorReact) Object.defineProperty(globalThis, 'React', priorReact); else Reflect.deleteProperty(globalThis, 'React'); dom.restore();
	}
});

test('a read for an immediate effect plans its own implicit all-audio context', () => {
	const f = fixture(); f.state.selectedClipId = ''; f.state.audacityEffectType = 'audacity-auto-duck';
	f.state.preferences.editing.applyEffectsToAllAudio = true; f.set(['b']);
	assert.equal(f.service.readSelectionTargetLocked(), false, 'Auto Duck requires explicit targets');
	assert.equal(f.service.readSelectionTargetLocked('audacity-invert'), true, 'Invert uses the actual implicit-all targets before its menu invocation changes effect type');
	assert.equal(f.state.audacityEffectType, 'audacity-auto-duck', 'read-only menu admission must not change active effect controls');
});

test('an immediate requested length-changing effect includes its silent selected targets', () => {
	const f = fixture(); f.state.selectedClipId = '';
	f.set(['b'], { ...f.project.selection, startFrame: 96_000, endFrame: 144_000, trackIds: ['a', 'b'] });
	assert.equal(f.service.readSelectionTargetLocked(), false);
	assert.equal(f.service.readSelectionTargetLocked('audacity-repeat'), true);
	assert.equal(f.state.audacityEffectType, 'audacity-amplify');
});

test('admission for current and requested effects leaves the control parameter cache unchanged', () => {
	const f = fixture(); f.set(['a']);
	const before = structuredClone(f.state);
	assert.equal(f.service.readSelectionTargetLocked(), true);
	assert.equal(f.service.readSelectionTargetLocked('audacity-invert'), true);
	assert.deepEqual(f.state, before);
});
