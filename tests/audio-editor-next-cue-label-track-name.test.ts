/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { labelFileProfileCustody, labelFileProject, labelFilePoints } from './helpers/label-file-profile-custody.ts';

for (const [name, albumTitle, expectedName] of [
	['Album.cue', '   ', 'Album'],
	['   .cue', '', 'Labels'],
	['Album.cue', '  Authored album  ', '  Authored album  '],
] as const) test(`CUE label import retains ${JSON.stringify({ name, albumTitle })} through history, Scape and file delivery`, async context => {
	const fixture = await labelFileProfileCustody(context);
	const { controller } = fixture;
	const before = structuredClone(labelFileProject(controller.project));
	const history = controller.getSnapshot().history.undoEntries.length;
	const file = new File([`TITLE "${albumTitle}"\nFILE "Recording.wav" WAVE\nTRACK 01 AUDIO\n TITLE "Opening cue"\n INDEX 01 00:01:00\n`], name,
		{ type: 'application/x-cue' });
	assert.equal(file.name, name);
	await fixture.import(file, { cueLabels: true });
	const published = labelFileProject(controller.project);
	const track = published.tracks.find(value => value.type === 'label'); assert.ok(track);
	assert.equal(track.name, expectedName);
	assert.deepEqual(labelFilePoints(published), [{ title: 'Opening cue', startFrame: 48_000, endFrame: 48_000 }]);
	assert.equal(controller.getSnapshot().history.undoEntries.length, history + 1);
	controller.actions.edit.undo();
	assert.deepEqual(controller.project?.tracks, before.tracks);
	controller.actions.edit.redo();
	assert.deepEqual(controller.project?.tracks, published.tracks);
	const recipient = await fixture.reopen();
	assert.equal(recipient.project.sources.length, 0);
	assert.equal(recipient.project.tracks.find(value => value.type === 'label')?.name, expectedName);
	assert.deepEqual(labelFilePoints(recipient.project), [{ title: 'Opening cue', startFrame: 48_000, endFrame: 48_000 }]);
	const restored = structuredClone(recipient.project), restoredHistory = recipient.controller.getSnapshot().history.undoEntries.length;
	const exported = await recipient.controller.actions.labels.export({ format: 'txt' });
	assert.equal(exported.labelCount, 1); assert.equal(exported.format, 'txt');
	assert.equal(exported.text, '1\t1\tOpening cue\n');
	assert.equal(fixture.saved.length, 1);
	const delivered = fixture.saved[0]; assert.ok(delivered);
	assert.ok(delivered.name.endsWith('.txt'));
	assert.equal(await delivered.text(), '1\t1\tOpening cue\n');
	assert.deepEqual(recipient.controller.project, restored);
	assert.deepEqual(await recipient.store.loadProject(restored.id), restored);
	assert.equal(recipient.controller.getSnapshot().history.undoEntries.length, restoredHistory);
});
