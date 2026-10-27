/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createControllerOwnedStateComposition } from '../src/common/editor/controller/composition/controller-owned-state-composition.ts';
import { createEffectControlsService } from '../src/common/editor/controller/effects/effect-controls-service.ts';
import { createEffectPresetActions } from '../src/common/editor/controller/effects/effect-library-action-groups.ts';
import { createEffectMacroLibraryService, createInitialEffectMacroLibrary } from '../src/common/editor/controller/effects/effect-macro-library-service.ts';
import { createAudioEditorEffectPresets, listAudioEditorEffectPresets } from '../src/common/editor/effect-presets.js';

const points = Array.from({ length: 32 }, (_, index) => ({ frequency: 20 + index * 100, gain: Math.sin(index) * 6 }));
const stamp = '2026-10-25T10:00:00.000Z';
function ownedLibraries() {
	const owned = createControllerOwnedStateComposition({ effectPresets: createAudioEditorEffectPresets(),
		initialEffectType: 'audacity-reverb', preferences: { workspace: 'music' }, phase: 'booting', readyMessage: 'Ready',
		mobile: false, defaultPixelsPerSecond: 120, timelineMinimumSeconds: 30, recordingInputGain: 1, preferredInputDeviceId: 'default' });
	return { state: owned.effectsAccess, ports: owned.effectsStatePorts };
}

function measureCurveSorts(run: () => void): number {
	const sort = Array.prototype.sort;
	let sorts = 0;
	Object.defineProperty(Array.prototype, 'sort', { configurable: true, writable: true,
		value(this: unknown[], compare: (left: unknown, right: unknown) => number) {
			if (this.length === points.length) sorts++;
			return sort.call(this, compare);
		} });
	try { run(); } finally { Object.defineProperty(Array.prototype, 'sort', { configurable: true, writable: true, value: sort }); }
	return sorts;
}

test('rack preset listing retains an owned unchanged catalog and detaches all public curve data', async () => {
	const { state, ports } = ownedLibraries();
	let writes = 0;
	const service = createEffectControlsService({ state, createId: prefix => `${prefix}-new`,
		copy: { audacitySelectionHint: '', controlTrackNotFound: '', rackEffectNotFound: '', ready: '', selectionEffectUnsupported: '' },
		getProject: () => assert.fail('Listing and importing library settings must not read project media.'),
		persistSetting: async () => { writes++; }, publishDocumentSnapshot() {}, setStatus() {},
		applySelectedAudacityEffect: async () => undefined, captureRackNoiseProfile: async () => undefined });
	const actions = createEffectPresetActions({ ...service, effectLibraryState: state,
		state: { selectedTrackId: null, projectAdministrationPending: false }, listAudioEditorEffectPresets },
		(_capability, operation) => operation);
	await actions.import(JSON.stringify({ schemaVersion: 1, presets: Array.from({ length: 40 }, (_, index) => ({
		id: `curve-${index}`, name: `Curve ${index}`, effectType: 'audacity-filter-curve-eq', params: { points }, createdAt: stamp, updatedAt: stamp,
	})) }));
	assert.equal(writes, 1);
	const expected = actions.list('audacity-reverb');
	const sorts = measureCurveSorts(() => { for (let index = 0; index < 10; index++) assert.deepEqual(actions.list('audacity-reverb'), expected); });
	assert.equal(sorts, 0);
	const curves = actions.list('audacity-filter-curve-eq');
	const first = curves[0]!.params.points as { frequency: number; gain: number }[];
	first[0]!.gain = 23;
	assert.notEqual((actions.list('audacity-filter-curve-eq')[0]!.params.points as { gain: number }[])[0]!.gain, 23);
	ports.bootstrap.resetLibraries(createAudioEditorEffectPresets());
	assert.ok(!actions.list('audacity-filter-curve-eq').some(preset => preset.id === 'curve-0'));
});

test('owned macro name edits validate only the edited draft and retain storage publication', async () => {
	const initial = createInitialEffectMacroLibrary({ schemaVersion: 1, macros: Array.from({ length: 40 }, (_, index) => ({
		id: `macro-${index}`, name: `Macro ${index}`, effects: [{ id: 'curve-step', type: 'audacity-filter-curve-eq', params: { points }, enabled: true }],
	})) });
	const { state, ports } = ownedLibraries(); ports.bootstrap.setEffectMacros(initial);
	let publications = 0, writes = 0;
	const service = createEffectMacroLibraryService({ state, createId: prefix => `${prefix}-new`,
		persistSetting: async () => { writes++; }, publishDocumentSnapshot: () => { publications++; },
		handleError: error => { throw error; } });
	const sorts = measureCurveSorts(() => {
		for (let index = 0; index < 10; index++) service.save({ id: 'rename-target', name: `Rename ${index}`,
			effects: [{ id: 'target-step', type: 'audacity-reverb', params: { roomSize: 25 }, enabled: true }] });
	});
	assert.equal(sorts, 0);
	assert.equal(publications, 10);
	assert.equal(state.effectMacros.macros.length, 41);
	assert.equal(state.effectMacros.macros[0], initial.macros[0]);
	assert.throws(() => service.save({ id: 'rename-target', name: 'Invalid', effects: [{ id: 'bad', type: 'missing-effect', params: {} }] }), /Unsupported|Unknown/u);
	await service.flush(); assert.ok(writes >= 1);
	ports.bootstrap.resetLibraries(createAudioEditorEffectPresets());
	assert.equal(service.list().length, 0);
});
