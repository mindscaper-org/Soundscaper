/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createEffect } from '../src/common/editor/effects.js';
import { createAudioClip, createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import type { AudioEditorCommand } from '../src/common/editor/commands/protocol.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { applySoundscaperProjectCommand as apply } from '../src/soundscaper/editor-project-commands.ts';
import { createSoundscaperProjectRuntimeSelection } from '../src/soundscaper/editor-project-runtime-selection.ts';
import { createAudioEditorController, createProjectStore } from './helpers/audio-editor-controller-harness.js';

function fixture(options: { occupied?: boolean; active?: boolean; importedWide?: boolean } = {}) {
	const sources = [1, 6].map(channelCount => createAudioSource({ id: `source-${channelCount}`,
		sampleRate: 48000, channelCount, frameCount: 4800 }));
	const clips = sources.map(source => createAudioClip({ id: `clip-${source.channelCount}`, sourceId: source.id,
		durationFrames: 4800, sourceDurationFrames: 4800 }));
	return createSoundscaperProject({ masterChannels: 6, sources, clips,
		tracks: [createAudioTrack({ id: 'rack', clipIds: options.importedWide ? ['clip-6'] : options.occupied === false ? [] : ['clip-1'],
			effectsActive: options.active !== false, effects: [createEffect('reverb', { id: 'room' })] }),
		createAudioTrack({ id: 'donor', clipIds: options.importedWide ? ['clip-1'] : options.occupied === false ? ['clip-1', 'clip-6'] : ['clip-6'] })] });
}
const move: AudioEditorCommand = { type: 'clip/move', clipId: 'clip-6', trackId: 'rack', timelineStartFrame: 9600 };
const disable: AudioEditorCommand = { type: 'effect/update', scope: 'track', trackId: 'rack', effectId: 'room', changes: { enabled: false } };

test('a clip transfer cannot introduce a wider active stereo-only rack, atomically', () => {
	const project = fixture(), before = structuredClone(project);
	assert.throws(() => apply(project, move), /support/iu);
	assert.deepEqual(project, before);
	assert.throws(() => apply(project, { type: 'clip/replace-source', clipId: 'clip-1', sourceId: 'source-6' }), /support/iu);
	assert.deepEqual(project, before);
});

for (const commands of [[move, disable], [disable, move]]) test('final batch admission allows a disabled processor regardless of child order', () => {
	const result = apply(fixture(), { type: 'batch', commands });
	const rack = result.tracks.find(track => track.id === 'rack');
	assert.ok(rack?.type === 'audio' && Array.isArray(rack.effects));
	assert.deepEqual(rack.clipIds, ['clip-1', 'clip-6']);
	const effect: unknown = rack.effects[0];
	assert.ok(effect && typeof effect === 'object');
	assert.equal(Reflect.get(effect, 'enabled'), false);
});

test('bypassed racks and passive imported violations remain editable, and repair moves remain possible', () => {
	assert.doesNotThrow(() => apply(fixture({ active: false }), move));
	const imported = fixture({ importedWide: true });
	assert.doesNotThrow(() => apply(imported, { type: 'track/update', trackId: 'rack', changes: { name: 'Inspection' } }));
	assert.doesNotThrow(() => apply(imported, { ...move, timelineStartFrame: 19200 }));
	const repaired = apply(imported, { ...move, trackId: 'donor' });
	assert.deepEqual(repaired.tracks.find(track => track.id === 'rack')?.clipIds, []);
});

test('removing the last rack clip is safe at a wide master, but adding wide media to that empty rack is refused', () => {
	const project = fixture();
	const empty = apply(project, { type: 'clip/remove', clipId: 'clip-1' });
	assert.deepEqual(empty.tracks.find(track => track.id === 'rack')?.clipIds, []);
	assert.throws(() => apply(empty, move), /support/iu);
	assert.throws(() => apply(fixture({ occupied: false }), move), /support/iu);
});

test('moving media into a supported multichannel chain remains admitted', () => {
	const project = fixture();
	const supported = createSoundscaperProject({ ...project, tracks: project.tracks.map(track => track.id === 'rack'
		? { ...track, effects: [createEffect('lowpass', { id: 'filter' })] } : track) });
	assert.doesNotThrow(() => apply(supported, move));
});

test('the public clip-properties transfer refuses the incompatible move without publishing or adding history', async context => {
	const runtime = createSoundscaperProjectRuntimeSelection();
	const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: context.name });
	const controller = createAudioEditorController(null, { headless: true, locale: 'en', projectRuntime: runtime,
		sessionController: runtime.createSessionController(), store });
	context.after(async () => { await controller.dispose(); });
	await controller.ready;
	const base = fixture();
	const project = createSoundscaperProject({ ...base, tracks: base.tracks.map(track => ({ ...track, effects: [] })) });
	await controller.actions.project.open(project);
	assert.ok(controller.actions.effects.add({ scope: 'track', trackId: 'rack', type: 'reverb' }));
	const before = controller.project, history = controller.getSnapshot().history.undoEntries.length;
	await assert.rejects(async () => { await controller.actions.edit.commit(move); }, /support/iu);
	assert.equal(controller.project, before);
	assert.equal(controller.getSnapshot().history.undoEntries.length, history);
	controller.actions.edit.undo();
	const restored = controller.project?.tracks.find(track => track.id === 'rack');
	assert.ok(restored?.type === 'audio' && Array.isArray(restored.effects));
	assert.equal(restored.effects.length, 0);
});
