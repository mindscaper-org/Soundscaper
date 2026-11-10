/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { labelFileProfileCustody, labelFileProject, labelFilePoints } from './helpers/label-file-profile-custody.ts';

for (const file of [
	{ name: 'audacity-labels.txt', type: 'text/plain', text: '0.125\t0.750\tTXT intro\n1.000\t1.500\tTXT outro\n',
		expected: [{ title: 'TXT intro', startFrame: 6000, endFrame: 36_000 }, { title: 'TXT outro', startFrame: 48_000, endFrame: 72_000 }] },
	{ name: 'browser-labels.vtt', type: 'text/vtt', text: 'WEBVTT\n\nintro\n00:00:00.250 --> 00:00:01.500\nVTT intro\n\noutro\n00:00:02.000 --> 00:00:03.250\nVTT outro\n',
		expected: [{ title: 'VTT intro', startFrame: 12_000, endFrame: 72_000 }, { title: 'VTT outro', startFrame: 96_000, endFrame: 156_000 }] },
]) test(`actual ${file.name} import preserves literal text/clocks through history and fresh product Scape`, async context => {
	const fixture = await labelFileProfileCustody(context);
	const before = labelFileProject(fixture.controller.project), history = fixture.controller.getSnapshot().history.undoEntries.length;
	await fixture.import(new File([file.text], file.name, { type: file.type }));
	const published = labelFileProject(fixture.controller.project);
	assert.equal(fixture.controller.getSnapshot().status.message, 'Imported 2 label(s).');
	assert.equal(fixture.controller.getSnapshot().history.undoEntries.length, history + 1);
	assert.deepEqual(labelFilePoints(published), file.expected);
	await fixture.controller.actions.edit.undo(); assert.deepEqual(fixture.controller.project?.tracks, before.tracks);
	await fixture.controller.actions.edit.redo(); assert.deepEqual(fixture.controller.project?.tracks, published.tracks);
	const recipient = await fixture.reopen();
	assert.deepEqual(labelFilePoints(recipient.project), file.expected); assert.equal(recipient.project.sources.length, 0);
});

test('actual TXT/SRT/WebVTT/Podcast label file profiles preserve every independent output byte after one real import and Scape', async context => {
	const fixture = await labelFileProfileCustody(context);
	await fixture.import(new File(['1\n00:00:00,250 --> 00:00:01,500\nIntro caption\n\n2\n00:00:02,000 --> 00:00:03,250\nOutro caption\n'],
		'browser-captions.srt', { type: 'application/x-subrip' }));
	const recipient = await fixture.reopen();
	const before = structuredClone(recipient.project), history = recipient.controller.getSnapshot().history.undoEntries.length;
	assert.deepEqual(labelFilePoints(before), [{ title: 'Intro caption', startFrame: 12_000, endFrame: 72_000 }, { title: 'Outro caption', startFrame: 96_000, endFrame: 156_000 }]);
	for (const [index, format] of ['txt', 'srt', 'vtt', 'json'].entries()) {
		const result = await recipient.controller.actions.labels.export({ format });
		assert.equal(result.labelCount, 2); assert.equal(result.format, format); assert.equal(result.cancelled, undefined);
		assert.equal(fixture.saved.length, index + 1);
		const output = fixture.saved[index]; assert.ok(output); assert.ok(output.name.endsWith(`.${format}`));
		const text = await output.text(); assert.equal(text, result.text);
		if (format === 'json') assert.deepEqual(JSON.parse(text), { version: '1.2.0', chapters: [{ startTime: .25, title: 'Intro caption' }, { startTime: 2, title: 'Outro caption' }] });
		else assert.equal(text, format === 'txt' ? '0.25\t1.5\tIntro caption\n2\t3.25\tOutro caption\n'
			: format === 'srt' ? '1\n00:00:00,250 --> 00:00:01,500\nIntro caption\n\n2\n00:00:02,000 --> 00:00:03,250\nOutro caption\n'
				: 'WEBVTT\n\n1\n00:00:00.250 --> 00:00:01.500\nIntro caption\n\n2\n00:00:02.000 --> 00:00:03.250\nOutro caption\n');
		assert.deepEqual(recipient.controller.project, before, 'export cannot mutate any project field');
		assert.equal(recipient.controller.getSnapshot().history.undoEntries.length, history);
		assert.deepEqual(await recipient.store.loadProject(before.id), before);
	}
});
