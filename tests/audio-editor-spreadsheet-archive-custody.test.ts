/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createAudioClip, createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { CLIP_SPREADSHEET_COLUMNS, getClipSpreadsheetRows } from '../src/common/editor/clip-spreadsheet.ts';
import { planClipSpreadsheetPaste } from '../src/common/editor/ui/clip-spreadsheet/paste.ts';
import { serializeSpreadsheetTsv } from '../src/common/editor/ui/clip-spreadsheet/clipboard.ts';
import { clipboardDocument, clipboardPcm, clipboardProject, createClipboardCustody } from './helpers/clipboard-source-custody.ts';
import { assertPcmChannelsEqual } from './helpers/assert-pcm-samples.ts';

async function fixture(context: TestContext) {
	const custody = await createClipboardCustody(context);
	const sources = ['First.wav', 'Second.wav'].map((name, index) => createAudioSource({ id: `source-${index}`, name,
		sampleRate: 48_000, frameCount: 24_000, channelCount: 2 }));
	const pcm = sources.map((_source, index) => [clipboardPcm(24_000, index * 2), clipboardPcm(24_000, index * 2 + 1)]);
	const project = createSoundscaperProject({ id: 'spreadsheet-custody', sources,
		tracks: [createAudioTrack({ id: 'origin', name: 'Origin', clipIds: ['first', 'second'] }),
			createAudioTrack({ id: 'plain', name: 'Voice' }), createAudioTrack({ id: 'spaced', name: ' Voice ' }), createAudioTrack({ id: 'other', name: 'Other' })],
		clips: sources.map((source, index) => createAudioClip({ id: index ? 'second' : 'first', title: source.name,
			sourceId: source.id, timelineStartFrame: index * 24_000, durationFrames: 24_000, sourceDurationFrames: 24_000 })) });
	await custody.open(project, new Map(sources.map((source, index) => [source.id, pcm[index]!])));
	const archive = async () => await custody.archive((name, channels) => {
		const index = sources.findIndex(source => source.name === name); assert.notEqual(index, -1);
		assertPcmChannelsEqual(channels, pcm[index]!);
	});
	const paste = async (text: string, range: Parameters<typeof planClipSpreadsheetPaste>[1]) => {
		const current = clipboardProject(custody.controller.project);
		const plan = planClipSpreadsheetPaste(text, range, getClipSpreadsheetRows(current));
		await custody.controller.actions.clip.pasteSpreadsheet(current.id, plan.edits, plan.newRows);
	};
	return { ...custody, sources, paste, archive };
}

test('boolean TSV values reach real clip history and native archives without changing PCM', async context => {
	const f = await fixture(context), { controller } = f;
	await controller.actions.clip.editSpreadsheet('spreadsheet-custody', [{ clipId: 'first', column: 'reversed', value: 'true' }]);
	const before = clipboardProject(controller.project);
	const reversed = CLIP_SPREADSHEET_COLUMNS.findIndex(column => column.id === 'reversed');
	const inverted = CLIP_SPREADSHEET_COLUMNS.findIndex(column => column.id === 'inverted');
	await f.paste('false', { top: 0, bottom: 0, left: reversed, right: reversed });
	assert.equal(controller.project?.clips[0]?.reversed, false);
	await controller.actions.edit.undo(); assert.deepEqual(clipboardDocument(clipboardProject(controller.project)), clipboardDocument(before));
	const history = controller.getSnapshot().history.undoEntries.length;
	await f.paste('true\tfalse\nfalse\ttrue', { top: 0, bottom: 1, left: reversed, right: inverted });
	const edited = clipboardProject(controller.project);
	assert.equal(controller.getSnapshot().history.undoEntries.length, history + 1);
	assert.deepEqual(edited.clips.map(clip => [clip.reversed, clip.inverted]), [[true, false], [false, true]]);
	assert.equal(serializeSpreadsheetTsv(getClipSpreadsheetRows(edited).map(row => [row.cells.reversed, row.cells.inverted])), 'true\tfalse\r\nfalse\ttrue');
	await controller.actions.edit.undo(); assert.deepEqual(clipboardDocument(clipboardProject(controller.project)), clipboardDocument(before));
	await controller.actions.edit.redo(); assert.deepEqual(clipboardDocument(clipboardProject(controller.project)), clipboardDocument(edited));
	await f.archive();
});

for (const invalid of ['speed', 'overflow'] as const) test(`${invalid} TSV paste refuses the whole transaction before history, storage or source changes`, async context => {
	const f = await fixture(context), { controller, store } = f;
	await controller.actions.project.flush();
	const before = clipboardProject(controller.project), history = controller.getSnapshot().history.undoEntries;
	if (invalid === 'speed') {
		const speed = CLIP_SPREADSHEET_COLUMNS.findIndex(column => column.id === 'speed');
		await assert.rejects(f.paste('1.5\n0', { top: 0, bottom: 1, left: speed, right: speed }), /speed/iu);
	} else {
		const rows = getClipSpreadsheetRows(before);
		const text = serializeSpreadsheetTsv([rows[0]!, rows[1]!, rows[0]!].map(row => CLIP_SPREADSHEET_COLUMNS.map(column => row.cells[column.id])));
		await assert.rejects(f.paste(text, { top: 0, bottom: 0, left: 0, right: 12 }), /outside/iu);
	}
	assert.deepEqual(controller.project, before); assert.deepEqual(controller.getSnapshot().history.undoEntries, history);
	assert.deepEqual(await store.loadProject(before.id), before);
	await f.archive();
});

test('a full spreadsheet row publishes independent source/timeline clocks, flags and fades in one reversible transaction', async context => {
	const f = await fixture(context), { controller } = f;
	const before = clipboardProject(controller.project), history = controller.getSnapshot().history.undoEntries.length;
	await f.paste(['New clip', 'origin', '2', 'source-0', '.05', '.1', '3', '1.5', '-6', '.01', '.02', 'true', 'false'].join('\t'), null);
	const edited = clipboardProject(controller.project), clip = edited.clips.find(item => !['first', 'second'].includes(item.id));
	assert.ok(clip?.kind === 'audio');
	assert.equal(controller.getSnapshot().history.undoEntries.length, history + 1);
	assert.deepEqual([clip.title, clip.sourceId, clip.timelineStartFrame, clip.sourceStartFrame, clip.sourceDurationFrames, clip.durationFrames],
		['New clip', 'source-0', 96_000, 2400, 7200, 4800]);
	assert.deepEqual([clip.pitchCents, clip.speedRatio, clip.gain, clip.fadeInFrames, clip.fadeOutFrames, clip.reversed, clip.inverted],
		[300, 1.5, 10 ** (-6 / 20), 480, 960, true, false]);
	assert.deepEqual(edited.tracks.find(track => track.id === 'origin')?.clipIds, ['first', 'second', clip.id]);
	await controller.actions.edit.undo(); assert.deepEqual(clipboardDocument(clipboardProject(controller.project)), clipboardDocument(before));
	await controller.actions.edit.redo(); assert.deepEqual(clipboardDocument(clipboardProject(controller.project)), clipboardDocument(edited));
	await f.archive();
});

for (const [reference, target] of [[' Voice ', 'spaced'], ['Voice', 'plain'], ['  Other  ', 'other'], [' spaced ', 'spaced']] as const)
	test(`TSV track ${JSON.stringify(reference)} resolves exact authored names before normalization and survives native custody`, async context => {
		const f = await fixture(context), { controller } = f;
		const before = clipboardProject(controller.project);
		await f.paste(['Pasted', reference, '0', 'source-0', '0', '.1'].join('\t'), null);
		const edited = clipboardProject(controller.project), clip = edited.clips.find(item => !['first', 'second'].includes(item.id)); assert.ok(clip);
		assert.deepEqual(edited.tracks.find(track => track.id === target)?.clipIds, [clip.id]);
		assert.equal(edited.tracks.length, 4); assert.equal(clip.durationFrames, 4800);
		await controller.actions.edit.undo(); assert.deepEqual(clipboardDocument(clipboardProject(controller.project)), clipboardDocument(before));
		await controller.actions.edit.redo(); assert.deepEqual(clipboardDocument(clipboardProject(controller.project)), clipboardDocument(edited));
		await f.archive();
	});
