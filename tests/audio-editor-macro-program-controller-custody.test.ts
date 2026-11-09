/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { validateSoundscaperProject } from '../src/soundscaper/editor-project-validation.ts';
import { macroControllerCustody } from './helpers/macro-controller-custody.ts';

const programs = [
	{ name: 'omitted time edge', program: [
		'await sound.select.frames(0, 38400);',
		"const selected = await sound.command('SelectTime', { start: .2 });",
		'sound.assertEqual(selected.startFrame, 9600); sound.assertEqual(selected.endFrame, 38400);',
	], range: [9600, 38400] },
	{ name: 'header read and relative selection', program: [
		'const selected = await sound.project.selection();',
		'sound.assertEqual(selected.startFrame, 0); sound.assertEqual(selected.endFrame, 38400);',
		"await sound.select.time(.2, 0, { relativeTo: 'selection-end' });",
	], range: [28800, 38400] },
	{ name: 'first spectral lower bound', program: ['await sound.select.frequencies({ low: 500 });'],
		range: [0, 0], frequency: { minimumFrequency: 500, maximumFrequency: 24000 } },
	{ name: 'remove every selected track', program: [
		'await sound.select.all();', "await sound.select.tracks({ track: 0, trackCount: 100, mode: 'remove' });",
		'const selected = await sound.project.selection(); sound.assertEqual(selected.trackIds.length, 0);',
		"try { await sound.command('Delete'); } catch (error) { sound.log.info('empty selection refused'); }",
	], range: [0, 38400], selectedTracks: [] },
	{ name: 'track start to cursor command', program: [
		'await sound.select.frames(19200, 19200);', "await sound.command('SelTrackStartToCursor');",
	], range: [0, 19200] },
	{ name: 'stored cursor descriptor refusal', program: [
		'await sound.select.frames(19200, 19200);',
		"let refused = false; try { await sound.command('SelCursorStoredCursor'); } catch (error) { refused = true; }",
		"sound.assert(refused, 'the stored cursor descriptor cannot run a different action');",
	], range: [19200, 19200] },
	{ name: 'callable virtual Date', program: [
		"sound.assertEqual(Date(), new Date(Date.now()).toString());", 'await sound.wait(1234);',
		"sound.assertEqual(Date(), new Date(1234).toString()); sound.assertEqual(Date.now(), 1234);",
	], range: [0, 0] },
] as const;

for (const entry of programs) test(`macro program ${entry.name} crosses the real controller and preserves archive PCM`, async context => {
	const { controller, project, assertArchiveCustody } = await macroControllerCustody(context);
	if (entry.name.includes('cursor')) await controller.actions.transport.seek(19_200);
	const result: unknown = await controller.actions.macros.runScript({ name: entry.name, source: entry.program.join('\n') });
	assert.ok(result && typeof result === 'object' && 'calls' in result && typeof result.calls === 'number');
	if (entry.name !== 'callable virtual Date') assert.ok(result.calls > 0);
	const after = controller.project; assert.ok(validateSoundscaperProject(after));
	assert.deepEqual([after.selection.startFrame, after.selection.endFrame], entry.range);
	if ('selectedTracks' in entry) assert.deepEqual(after.selection.trackIds, entry.selectedTracks);
	if ('frequency' in entry) assert.deepEqual(after.selection.frequencyRange, entry.frequency);
	assert.equal(after.clips.length, 1); assert.equal(after.tracks.length, 1); assert.equal(after.sources.length, 1);
	assert.deepEqual(after.clips[0], project.clips[0]);
	const reopened = await assertArchiveCustody();
	assert.equal(reopened.clips.length, 1); assert.equal(reopened.tracks.length, 1);
});
