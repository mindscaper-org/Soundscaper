/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { addLabelThroughEdit, addLabelThroughManager, assertLabelArchiveCustody, importWorkspaceLabels, labelCustodySession, labelPoints, labelProject } from './helpers/label-routing-archive-custody.tsx';

for (const encoding of ['windows-1252', 'utf-16le'] as const) test(`${encoding} extensionless SubRip crosses real File Import, history and fresh Scape`, async context => {
	const session = await labelCustodySession(context), { controller } = session;
	const text = '1\r\n00:00:00,100 --> 00:00:00,500\r\nÉlodie au café\r\n';
	const bytes = encoding === 'windows-1252' ? Buffer.from(text, 'latin1') : Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, 'utf16le')]);
	await importWorkspaceLabels(controller, new File([bytes], 'Captions', { type: 'application/x-subrip' }));
	const published = labelProject(controller.project);
	controller.actions.edit.undo(); assert.deepEqual(labelPoints(labelProject(controller.project)), []);
	controller.actions.edit.redo(); assert.deepEqual(controller.project?.tracks, published.tracks);
	await assertLabelArchiveCustody(context, session, project => assert.deepEqual(labelPoints(project).map(({ title, startFrame, endFrame }) => ({ title, startFrame, endFrame })), [
		{ title: 'Élodie au café', startFrame: 4_800, endFrame: 24_000 },
	]));
});

for (const [name, mimeType, body] of [
	['Session.text', 'text/plain', '0\t0.1\tOpening dialogue\n'],
	['Session.sub', 'application/x-subrip', '1\n00:00:00,000 --> 00:00:00,100\nOpening dialogue\n'],
	['Session.captions', 'text/vtt', 'WEBVTT\n\n00:00.000 --> 00:00.100\nOpening dialogue\n'],
] as const) test(`${mimeType} with a nonstandard suffix preserves exact label clocks through real import and archive`, async context => {
	const session = await labelCustodySession(context), { controller } = session;
	await importWorkspaceLabels(controller, new File([body], name, { type: mimeType }));
	const published = labelProject(controller.project);
	controller.actions.edit.undo(); assert.deepEqual(labelPoints(labelProject(controller.project)), []);
	controller.actions.edit.redo(); assert.deepEqual(controller.project?.tracks, published.tracks);
	await assertLabelArchiveCustody(context, session, project => assert.deepEqual(labelPoints(project).map(({ title, startFrame, endFrame }) => ({ title, startFrame, endFrame })), [
		{ title: 'Opening dialogue', startFrame: 0, endFrame: 4_800 },
	]));
});

for (const format of ['srt', 'cue'] as const) test(`oversized ${format} refuses before allocation and preserves a real UTF16 SubRip retry in fresh Scape`, async context => {
	const session = await labelCustodySession(context), { controller } = session;
	const before = controller.project, history = controller.getSnapshot().history.undoEntries.length;
	let reads = 0;
	class ObservedFile extends File {
		override async arrayBuffer(): Promise<ArrayBuffer> { reads++; return super.arrayBuffer(); }
	}
	const oversized = new ObservedFile([new Uint8Array(3 * 16 * 1024 * 1024 + 4)], `Too large.${format}`);
	await assert.rejects(importWorkspaceLabels(controller, oversized), /input limit/u);
	assert.equal(reads, 0); assert.equal(controller.project, before); assert.equal(controller.getSnapshot().history.undoEntries.length, history);
	const bytes = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('1\r\n00:00:00,000 --> 00:00:01,000\r\n漢字\r\n', 'utf16le')]);
	await importWorkspaceLabels(controller, new File([bytes], 'Healthy.srt', { type: 'application/x-subrip' }));
	await assertLabelArchiveCustody(context, session, project => assert.deepEqual(labelPoints(project).map(({ title, startFrame, endFrame }) => ({ title, startFrame, endFrame })), [
		{ title: '漢字', startFrame: 0, endFrame: 48_000 },
	]));
});

for (const available of [false, true]) test(`actual Add label skips locked tracks and persists editable peer=${available}`, async context => {
	const session = await labelCustodySession(context), { controller } = session;
	await controller.actions.project.open(createSoundscaperProject({ id: context.name, tracks: [
		createAudioTrack({ id: 'voice', name: 'Voice' }), { id: 'locked', type: 'label', name: 'Locked labels', locked: true, labels: [] },
		...(available ? [{ id: 'writable', type: 'label', name: 'Writable labels', labels: [] }] : []),
	] }));
	controller.actions.timeline.selectTrack('voice'); const before = labelProject(controller.project);
	addLabelThroughEdit(controller);
	const after = labelProject(controller.project), target = labelPoints(after)[0]; assert.ok(target);
	assert.notEqual(target.trackId, 'locked'); if (available) assert.equal(target.trackId, 'writable');
	else { assert.equal(target.trackName, 'Labels'); assert.equal(after.tracks.length, before.tracks.length + 1); }
	controller.actions.edit.undo(); assert.deepEqual(controller.project?.tracks, before.tracks);
	controller.actions.edit.redo(); assert.deepEqual(controller.project?.tracks, after.tracks);
	await assertLabelArchiveCustody(context, session, project => {
		assert.deepEqual(labelPoints(project), [{ ...target, title: '', startFrame: 0, endFrame: 0 }]);
		assert.deepEqual(project.tracks.find(track => track.id === 'locked'), before.tracks.find(track => track.id === 'locked'));
	});
});

for (const entry of ['Edit', 'Manage labels'] as const) for (const existing of [false, true]) test(`${entry} publishes to the focused sequence through actual owner; existing=${existing}`, async context => {
	const session = await labelCustodySession(context), { controller } = session;
	await controller.actions.project.open(createSoundscaperProject({ id: context.name, tracks: [
		...(existing ? [{ id: 'own-labels', name: 'Own labels', type: 'label', labels: [] }] : []),
		createAudioTrack({ id: 'voice', name: 'Voice' }), { id: 'foreign-labels', name: 'Foreign labels', type: 'label', labels: [] },
	], sequences: [{ id: 'main', trackIds: [...(existing ? ['own-labels'] : []), 'voice'] }, { id: 'other', trackIds: ['foreign-labels'] }], primarySequenceId: 'main' }));
	controller.actions.timeline.selectTrack('voice'); const before = labelProject(controller.project);
	if (entry === 'Edit') addLabelThroughEdit(controller); else await addLabelThroughManager(controller);
	const after = labelProject(controller.project), target = labelPoints(after)[0]; assert.ok(target);
	if (existing) assert.equal(target.trackId, 'own-labels'); else assert.equal(target.trackName, 'Labels');
	controller.actions.edit.undo(); assert.deepEqual(controller.project?.tracks, before.tracks); assert.deepEqual(controller.project?.sequences, before.sequences);
	controller.actions.edit.redo(); assert.deepEqual(controller.project?.tracks, after.tracks);
	await assertLabelArchiveCustody(context, session, project => {
		assert.deepEqual(labelPoints(project), [{ ...target, title: entry === 'Edit' ? '' : 'New label', startFrame: 0, endFrame: 0 }]);
		assert.ok(project.sequences.find(sequence => sequence.id === 'main')?.trackIds.includes(target.trackId));
		assert.deepEqual(project.sequences.find(sequence => sequence.id === 'other'), before.sequences.find(sequence => sequence.id === 'other'));
		assert.deepEqual(project.tracks.find(track => track.id === 'foreign-labels'), before.tracks.find(track => track.id === 'foreign-labels'));
	});
});
