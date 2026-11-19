/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { macroControllerCustody } from './helpers/macro-controller-custody.ts';
import { MACRO_SCRIPT_LIBRARY_SETTING_KEY } from '../src/common/editor/controller/effects/macro-script-library-service.ts';

test('programs capture and restore zoom, scroll and track presentation through the real controller', async context => {
	const { controller, assertArchiveCustody } = await macroControllerCustody(context);
	const originalHeight = controller.project?.tracks[0]?.height;
	const entries = controller.getSnapshot().history.undoEntries.length;
	let scroll = { scrollX: 0, scrollY: 0 };
	const unbind = controller.actions.macros.bindViewport({
		read: () => scroll,
		write: async position => { scroll = position; },
	});
	context.after(unbind);
	await controller.actions.macros.runScript({ name: 'View memory', source: [
		'await sound.view.set({ pixelsPerSecond: 2000, autoFitTrackHeight: false, scrollX: 120, scrollY: 40,',
		"  tracks: [{ id: 'voice', height: 180, displayMode: 'spectrogram' }] });",
		'const remembered = await sound.view.snapshot();',
		'sound.assertEqual(remembered.pixelsPerSecond, 2000);',
		'sound.assertEqual(remembered.scrollX, 120); sound.assertEqual(remembered.scrollY, 40);',
		'sound.assertEqual(remembered.tracks[0].height, 180);',
		'await sound.view.zoom("in");',
		'sound.assertEqual((await sound.view.snapshot()).pixelsPerSecond, 4000);',
		'await sound.view.set({ pixelsPerSecond: 1000, tracks: [{ id: "voice", height: 90, displayMode: "waveform" }] });',
		'await sound.view.set(remembered);',
		'sound.assertEqual(await sound.view.snapshot(), remembered);',
	].join('\n') });
	assert.deepEqual(scroll, { scrollX: 120, scrollY: 40 });
	assert.ok(controller.project);
	assert.equal(controller.project.tracks[0]?.height, 180);
	const reopened = await assertArchiveCustody();
	assert.equal(reopened.tracks[0]?.displayMode, 'spectrogram');
	assert.equal(controller.getSnapshot().history.undoEntries.length, entries + 1);
	controller.actions.edit.undo();
	assert.equal(controller.project?.tracks[0]?.height, originalHeight);
	assert.equal(controller.getSnapshot().timeline.pixelsPerSecond, 2000, 'project Undo leaves transient zoom alone');
});

test('a failed program restores its view and discards its queued self edit', async context => {
	const { controller } = await macroControllerCustody(context);
	let scroll = { scrollX: 20, scrollY: 10 };
	context.after(controller.actions.macros.bindViewport({ read: () => scroll, write: async value => { scroll = value; } }));
	const source = [
		'await sound.view.set({ pixelsPerSecond: 2000, scrollX: 500, scrollY: 80, tracks: [{ id: "voice", height: 210 }] });',
		'await sound.self.replaceSource("sound.log.info(2);");',
		'throw new Error("failed after staging");',
	].join('\n');
	const script = controller.actions.macros.scripts.save({ name: 'Failure', source });
	const before = controller.getSnapshot().timeline;
	await assert.rejects(controller.actions.macros.runScript({ scriptId: script.id, name: script.name, source }), /failed after staging/u);
	assert.equal(controller.getSnapshot().timeline.pixelsPerSecond, before.pixelsPerSecond);
	assert.equal(controller.getSnapshot().timeline.autoFitTrackHeight, before.autoFitTrackHeight);
	assert.deepEqual(scroll, { scrollX: 20, scrollY: 10 });
	assert.equal(controller.actions.macros.scripts.list()[0]?.source, source);
	assert.ok(controller.project);
	assert.notEqual(controller.project.tracks[0]?.height, 210);
});

test('a saved program replaces only itself, persists and runs its new source next time', async context => {
	const { controller, store } = await macroControllerCustody(context);
	const entries = controller.getSnapshot().history.undoEntries.length;
	const untouched = controller.actions.macros.scripts.save({ name: 'Other', source: 'sound.log.info("other");' });
	const source = 'sound.log.info(await sound.self.source()); await sound.self.replaceSource("sound.log.info(42);");';
	const script = controller.actions.macros.scripts.import(JSON.stringify({ schemaVersion: 1, kind: 'script', engine: 'soundscaper-macro-js/1', name: 'Counter', source }), 'counter.soundscapemacro');
	const result = await controller.actions.macros.runScript({ scriptId: script.id, name: script.name, source });
	assert.ok(result.log.some(entry => entry.text === source));
	const next = controller.actions.macros.scripts.list().find(candidate => candidate.id === script.id);
	assert.deepEqual(next, { ...script, source: 'sound.log.info(42);' });
	assert.deepEqual(controller.actions.macros.scripts.list()[0], untouched);
	await controller.actions.macros.scripts.flush();
	const persisted = await store.loadSetting(MACRO_SCRIPT_LIBRARY_SETTING_KEY);
	assert.deepEqual(persisted, { schemaVersion: 1, scripts: [untouched, next] });
	assert.ok(next);
	const rerun = await controller.actions.macros.runScript({ scriptId: next.id, name: next.name, source: next.source });
	assert.ok(rerun.log.some(entry => entry.text === '42'));
	assert.equal(controller.getSnapshot().history.undoEntries.length, entries, 'self edits do not create project Undo entries');
});

test('an unsaved program cannot edit the library and a stale source cannot claim a saved identity', async context => {
	const { controller } = await macroControllerCustody(context);
	const source = 'await sound.self.replaceSource("sound.log.info(99);");';
	const script = controller.actions.macros.scripts.save({ name: 'Saved', source });
	await assert.rejects(controller.actions.macros.runScript({ name: script.name, source }), /saved program/u);
	await assert.rejects(controller.actions.macros.runScript({ scriptId: script.id, name: script.name, source: source + '\n' }), /changed/u);
	assert.equal(controller.actions.macros.scripts.list()[0]?.source, source);
});

test('invalid view requests are refused before any view or track changes', async context => {
	const { controller } = await macroControllerCustody(context);
	await controller.actions.macros.runScript({ name: 'Invalid views', source: [
		'const initial = await sound.view.snapshot();',
		'for (const request of [{ pixelsPerSecond: -1 }, { scrollX: -1 }, { view: "bad" },',
		'  { tracks: [{ id: "missing", height: 140 }] }, { projectId: "another" },',
		'  { tracks: [{ id: "voice", height: 200, gain: 0 }] }, { tracks: [{ id: "voice", collapsed: true }] }, { arbitrary: true }]) {',
		'  let refused = false; try { await sound.view.set(request); } catch { refused = true; }',
		'  sound.assert(refused, "Invalid view accepted");',
		'  sound.assertEqual(await sound.view.snapshot(), initial);',
		'}',
	].join('\n') });
});
