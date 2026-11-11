/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { labelFileProfileCustody, labelFileProject, labelFilePoints } from './helpers/label-file-profile-custody.ts';

test('adjacent imported label samples survive controller history, Scape and actual Podcast JSON file delivery', async context => {
	const fixture = await labelFileProfileCustody(context);
	const { controller } = fixture;
	const before = structuredClone(labelFileProject(controller.project));
	const history = controller.getSnapshot().history.undoEntries.length;
	await fixture.import(new File(['0.5\t0.5\tFirst boundary\n0.5000208333333333\t0.5000208333333333\tNext sample\n'],
		'Precision.txt', { type: 'text/plain' }));
	const expected = [{ title: 'First boundary', startFrame: 24_000, endFrame: 24_000 },
		{ title: 'Next sample', startFrame: 24_001, endFrame: 24_001 }];
	const published = labelFileProject(controller.project);
	assert.equal(published.sampleRate, 48_000);
	assert.equal(controller.getSnapshot().status.message, 'Imported 2 label(s).');
	assert.deepEqual(labelFilePoints(published), expected);
	assert.equal(controller.getSnapshot().history.undoEntries.length, history + 1);
	controller.actions.edit.undo(); assert.deepEqual(controller.project?.tracks, before.tracks);
	controller.actions.edit.redo(); assert.deepEqual(controller.project?.tracks, published.tracks);
	const recipient = await fixture.reopen();
	assert.deepEqual(labelFilePoints(recipient.project), expected);
	assert.equal(recipient.project.sources.length, 0);
	const restored = structuredClone(recipient.project), restoredHistory = recipient.controller.getSnapshot().history.undoEntries.length;
	const result = await recipient.controller.actions.labels.export({ format: 'json' });
	assert.equal(result.format, 'json'); assert.equal(result.labelCount, 2);
	assert.equal(result.mimeType, 'application/json+chapters');
	assert.equal(fixture.saved.length, 1);
	const delivered = fixture.saved[0]; assert.ok(delivered);
	assert.ok(delivered.name.endsWith('.json'));
	assert.equal(delivered.type, 'application/json+chapters');
	const text = await delivered.text(); assert.equal(text, result.text);
	const document: unknown = JSON.parse(text);
	assert.deepEqual(document, { version: '1.2.0', chapters: [
		{ startTime: .5, title: 'First boundary' }, { startTime: 24_001 / 48_000, title: 'Next sample' },
	] });
	assert.deepEqual(recipient.controller.project, restored);
	assert.deepEqual(await recipient.store.loadProject(restored.id), restored);
	assert.equal(recipient.controller.getSnapshot().history.undoEntries.length, restoredHistory);
});
