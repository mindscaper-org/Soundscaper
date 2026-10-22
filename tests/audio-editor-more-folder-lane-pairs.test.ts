/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { createMacroCommandStep } from '../src/common/editor/macro-command-steps.ts';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createSoundscaperProjectRuntimeSelection } from '../src/soundscaper/editor-project-runtime-selection.ts';
import { createAudioTrack, createVideoTrack } from '../src/common/editor/project-media-factory.ts';
import { createMemoryFfmpeg } from './helpers/audio-editor-controller-fixtures.js';
import { COPY, createAudioEditorController, createMemoryEngine, createProjectStore } from './helpers/audio-editor-controller-harness.js';

for (const member of ['video', 'audio', 'both'] as const) test(`MP47: Wrap Selected Tracks keeps a linked A/V block intact (${member})`, async context => {
	type Options = NonNullable<Parameters<typeof createAudioEditorController>[1]>;
	const runtime = createSoundscaperProjectRuntimeSelection();
	const controller = createAudioEditorController(null, { headless: true, productId: 'soundscaper', locale: 'en', copy: COPY,
		projectRuntime: runtime, sessionController: runtime.createSessionController(),
		store: createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: context.name }),
		engine: createMemoryEngine() as unknown as Options['engine'], ffmpeg: createMemoryFfmpeg() as unknown as Options['ffmpeg'] });
	context.after(async () => { await controller.dispose(); }); await controller.ready;
	await controller.actions.project.open(createSoundscaperProject({ id: 'camera-edit', tracks: [
		createVideoTrack({ id: 'camera-video', name: 'Camera', laneGroupId: 'camera-pair' }),
		createAudioTrack({ id: 'camera-audio', name: 'Camera Audio', laneGroupId: 'camera-pair' }),
		createAudioTrack({ id: 'voice', name: 'Voice' }),
	] }));
	await controller.actions.macros.run({ name: 'Select camera and narration', effects: [
		createMacroCommandStep('SelectTracks', { params: { track: member === 'audio' ? 1 : 0, trackCount: member === 'both' ? 2 : 1, mode: 'set' } }),
		createMacroCommandStep('SelectTracks', { params: { track: 2, trackCount: 1, mode: 'add' } }),
	] });
	assert.deepEqual(controller.project?.selection.trackIds, [
		...(member === 'audio' ? ['camera-audio'] : member === 'video' ? ['camera-video'] : ['camera-video', 'camera-audio']), 'voice',
	]);
	const previousReact = Object.getOwnPropertyDescriptor(globalThis, 'React');
	Object.defineProperty(globalThis, 'React', { configurable: true, value: React });
	context.after(() => { if (previousReact) Object.defineProperty(globalThis, 'React', previousReact); else Reflect.deleteProperty(globalThis, 'React'); });
	const { createTimelineMenuModel } = await import('../src/common/editor/ui/timeline/timeline-menu-model.js');
	const snapshot = controller.getSnapshot();
	const menu = createTimelineMenuModel({ controller, snapshot, copy: ENGLISH_COPY, locale: 'en', mutationsBlocked: false,
		state: { trackMenu: { trackId: member === 'audio' ? 'camera-audio' : 'camera-video' }, outputMenu: null, trackColorMenu: null, clipMenu: null,
			trackRulerFlyout: null, waveformRulerState: {}, setTrackColorMenu() {}, setWaveformRulerState() {}, loopPreview: null },
		model: { project: controller.project, sampleRate: 48_000 }, menuActions: { run: (work: () => unknown) => work() },
		productId: 'soundscaper', capabilities: snapshot.capabilities, showArmControls: false, onToggleArmControls() {},
		onOpenSurface() {}, automationControls: null, freezeRuntime: undefined,
	});
	const wrap = (menu.trackMenuItems as readonly Readonly<{ label?: string; disabled?: boolean; onClick?: () => unknown }>[]).find(item => item.label === ENGLISH_COPY.wrapTracksInFolder);
	assert.ok(wrap); assert.equal(wrap.disabled, false); wrap.onClick?.();
	const folder = controller.project?.trackFolders[0]?.id; assert.ok(folder);
	const project = controller.project; assert.ok(project);
	const nodes = project.sequences.find(({ id }) => id === project.primarySequenceId)?.trackNodes ?? [];
	assert.deepEqual(nodes.map(({ id, parentFolderId }) => [id, parentFolderId]), [
		[folder, null], ['camera-video', folder], ['camera-audio', folder], ['voice', folder],
	]);
	controller.actions.edit.undo(); assert.equal(controller.project?.trackFolders.length, 0);
});
