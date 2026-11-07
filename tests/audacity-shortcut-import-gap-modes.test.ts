/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { importShortcutPreferences } from './helpers/shortcut-import-custody.ts';
import { controllerSession } from './helpers/soundscaper-controller-session.ts';
import { resolveAudacityActionHandler } from '../src/common/editor/audacity-action-parity.js';
import { resolveRuntimeProjectProjection } from '../src/common/editor/runtime-clip-projection.ts';
import { encodeWav } from '../src/common/editor/wav.js';
import { parseAudacityShortcutImport } from '../src/common/editor/audacity-shortcut-import.ts';

for (const [command, target] of [
	['Cut', 'cut-per-track-ripple'], ['Delete', 'delete-per-track-ripple'],
	['DeleteKey', 'delete-per-track-ripple'], ['DeleteKey2', 'delete-per-track-ripple'],
] as const) test(`native legacy ${command} keeps its fixed selected-track close-gap behavior`, () => {
	const current = { 'action://cut': ['Ctrl+X'], 'action://delete': ['Delete'],
		'cut-per-track-ripple': ['Shift+X'], 'delete-per-track-ripple': ['Shift+Delete'] };
	const plan = parseAudacityShortcutImport(`<audacitykeyboard audacityversion="3.7.7"><command name="${command}" key="Ctrl+Alt+Shift+F7"/></audacitykeyboard>`, current,
		{ availableActionIds: Object.keys(current) });
	assert.equal(plan.importedCount, 1);
	assert.deepEqual(plan.skipped, []);
	assert.deepEqual(plan.shortcuts, { ...current, [target]: ['Ctrl+Alt+Shift+F7'] });
});

test('legacy split cut and split delete retain their independent leave-gap behavior', () => {
	const plan = parseAudacityShortcutImport('<audacitykeyboard audacityversion="3.7.7"><command name="SplitCut" key="Ctrl+F7"/><command name="SplitDelete" key="Ctrl+F8"/></audacitykeyboard>', {});
	assert.equal(plan.importedCount, 2);
	assert.deepEqual(plan.skipped, []);
	assert.deepEqual(plan.shortcuts, { 'cut-leave-gap': ['Ctrl+F7'], 'delete-leave-gap': ['Ctrl+F8'] });
});

test('modern generic Cut and Delete continue using the editor preference-driven actions', () => {
	const plan = parseAudacityShortcutImport('<Shortcuts><SC><key>action://cut</key><seq>Ctrl+F7</seq></SC><SC><key>action://delete</key><seq>Ctrl+F8</seq></SC></Shortcuts>', {});
	assert.equal(plan.importedCount, 2);
	assert.deepEqual(plan.skipped, []);
	assert.deepEqual(plan.shortcuts, { 'action://cut': ['Ctrl+F7'], 'action://delete': ['Ctrl+F8'] });
});

for (const [command, target, expectedStart] of [
	['Cut', 'cut-per-track-ripple', 9600], ['Delete', 'delete-per-track-ripple', 9600],
	['DeleteKey', 'delete-per-track-ripple', 9600], ['DeleteKey2', 'delete-per-track-ripple', 9600],
	['SplitCut', 'cut-leave-gap', 19200], ['SplitDelete', 'delete-leave-gap', 19200],
] as const) test(`${command} persists and executes its fixed gap mode through the real action handler`, async context => {
	const { plan, persisted, saves } = await importShortcutPreferences(context,
		`<audacitykeyboard><command name="${command}" key="Ctrl+Alt+Shift+F7"/></audacitykeyboard>`, {});
	assert.equal(plan.importedCount, 1); assert.equal(saves, 1);
	assert.deepEqual(persisted[target], ['Ctrl+Alt+Shift+F7']);
	const { controller } = await controllerSession(context);
	const samples = Float32Array.from({ length: 48_000 }, (_, frame) => (frame % 31 - 15) / 64);
	await controller.actions.project.importFiles([new File([Uint8Array.from(encodeWav([samples], { sampleRate: 48_000, float: true }))], 'Take.wav')]);
	const project = controller.project; assert.ok(project);
	const firstClip = resolveRuntimeProjectProjection(project).clips[0]; assert.ok(firstClip);
	controller.actions.timeline.selectClip(firstClip.id);
	controller.actions.timeline.setSelection(9600, 19200);
	const importedAction = Object.keys(persisted).find(action => persisted[action]?.includes('Ctrl+Alt+Shift+F7')); assert.equal(importedAction, target);
	const handler = resolveAudacityActionHandler(importedAction, controller.actions); assert.ok(handler);
	await handler();
	const clips = resolveRuntimeProjectProjection(controller.project).clips.slice().sort((a, b) => a.timelineStartFrame - b.timelineStartFrame);
	assert.equal(clips.length, 2, JSON.stringify({ clips, selection: controller.getSnapshot().selection, status: controller.getSnapshot().status })); assert.equal(clips[0]?.durationFrames, 9600);
	assert.equal(clips[1]?.timelineStartFrame, expectedStart); assert.equal(clips[1]?.sourceStartFrame, 19200);
	assert.equal(clips[1]?.durationFrames, 28800);
	controller.actions.edit.undo(); assert.equal(resolveRuntimeProjectProjection(controller.project).clips.length, 1);
	controller.actions.edit.redo(); assert.equal(resolveRuntimeProjectProjection(controller.project).clips[1]?.timelineStartFrame, expectedStart);
});
