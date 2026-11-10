/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { readWithReference, referenceItems } from './helpers/interchange-reference.ts';
import { framescaperInterchangeCustody } from './helpers/framescaper-interchange-custody.ts';

for (const length of [30, 90]) test(`EDL retains the controller-renamed ${length}-character title through real media/archive custody`, async context => {
	const fixture = await framescaperInterchangeCustody(context);
	const title = `Production ${'x'.repeat(length - 11)}`;
	await fixture.controller.actions.project.rename(title);
	const saved = await fixture.deliver('edl');
	assert.equal(saved.project.title, title);
	assert.equal(saved.text.split('\n')[0], `TITLE: ${title}`);
	assert.equal(readWithReference(saved.text, 'cmx_3600', { rate: 30 }, '.edl')[0]?.name, title);
});

test('EDL prototype-bearing source identity retains its real reel after controller import and portable reopen', async context => {
	const fixture = await framescaperInterchangeCustody(context, { sourceId: 'toString' });
	const saved = await fixture.deliver('edl');
	assert.equal(saved.project.sources[0]?.id, 'toString');
	assert.equal(saved.text.split('\n').find(line => /^001\s/u.test(line))?.trim().split(/\s+/u)[1], 'CAMERA');
	assert.ok(saved.text.includes('* FROM CLIP NAME: Picture'));
});

for (const fps of [60, 120]) test(`EDL ${fps}fps admission retains exact frame fields after real archive reopening`, async context => {
	const fixture = await framescaperInterchangeCustody(context, { fps, sourceInFrame: 29 });
	if (fps === 120) {
		await assert.rejects(fixture.deliver('edl'), /two.digit/u);
		const saved = await fixture.deliver('otio');
		const document: unknown = JSON.parse(saved.text);
		assert.ok(typeof document === 'object' && document !== null && 'metadata' in document);
		const metadata = document.metadata;
		assert.ok(typeof metadata === 'object' && metadata !== null && 'media.kw.soundscaper' in metadata);
		const extension = metadata['media.kw.soundscaper'];
		assert.ok(typeof extension === 'object' && extension !== null && 'sequenceRate' in extension);
		assert.deepEqual(extension.sequenceRate, { num: 120, den: 1 });
	} else {
		const saved = await fixture.deliver('edl');
		assert.ok(saved.text.includes('00:00:00:58 00:00:01:58'));
		const item = referenceItems(readWithReference(saved.text, 'cmx_3600', { rate: fps }, '.edl'))[0];
		assert.ok(item); assert.equal(item.startRate, 60); assert.equal(item.durationValue, 60);
	}
});

for (const negative of [false, true]) test(`OTIO ${negative ? 'negative' : 'positive'} origin preserves media placement across controller, Scape and delivery`, async context => {
	const fixture = await framescaperInterchangeCustody(context);
	fixture.controller.actions.sequences.update('main', { startTimecode: { negative, hours: 0, minutes: 0, seconds: 10, frames: 0 } });
	const saved = await fixture.deliver('otio');
	assert.deepEqual(saved.project.clips, fixture.initial.clips);
	const document: unknown = JSON.parse(saved.text);
	assert.ok(typeof document === 'object' && document !== null && 'global_start_time' in document);
	assert.deepEqual(document.global_start_time, { OTIO_SCHEMA: 'RationalTime.1', value: negative ? -300 : 300, rate: 30 });
	const reference = readWithReference(saved.text, 'otio_json', {}, '.otio')[0]; assert.ok(reference);
	assert.equal(reference.globalStartValue, negative ? -300 : 300);
	assert.equal(reference.globalStartRate, 30);
	const item = reference.tracks[0]?.items[0]; assert.ok(item);
	assert.equal(item.startValue, 0); assert.equal(item.durationValue, 30);
});
