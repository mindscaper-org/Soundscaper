/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createEdlExport } from '../src/common/editor/edl-export.ts';
import { readWithReference } from './helpers/interchange-reference.ts';

const event = { reel: 'CAMERA', trackKind: 'V' as const, sourceInFrames: 0, sourceOutFrames: 30,
	recordInFrames: 0, recordOutFrames: 30 };
const longTitle = `Production ${'x'.repeat(79)}`;
for (const title of ['Ordinary title', 'x'.repeat(70), longTitle, `${'a'.repeat(69)}🎬 Extended cut`]) {
	test(`EDL keeps the complete title of ${title.length} UTF16 units`, () => {
		const output = createEdlExport({ title, rate: { num: 30, den: 1 }, events: [event] });
		assert.equal(output.text.split('\n')[0], `TITLE: ${title}`);
		assert.equal(readWithReference(output.text, 'cmx_3600', { rate: 30 }, '.edl')[0]?.name, title);
	});
}

test('the independently provisioned CMX reader accepts a title longer than70 characters', () => {
	const text = `TITLE: ${longTitle}\nFCM: NON-DROP FRAME\n001 CAMERA   V C        00:00:00:00 00:00:01:00 00:00:00:00 00:00:01:00\n`;
	assert.equal(readWithReference(text, 'cmx_3600', { rate: 30 }, '.edl')[0]?.name, longTitle);
});

test('EDL title normalization still prevents extra structural lines', () => {
	const output = createEdlExport({ title: 'Opening\r\nFCM: DROP FRAME\u2028Ending', rate: { num: 30, den: 1 }, events: [event] });
	assert.deepEqual(output.text.split('\n').filter(line => line.startsWith('TITLE:')), ['TITLE: Opening FCM: DROP FRAME Ending']);
	assert.equal(output.text.split('\n').filter(line => line.startsWith('FCM:')).length, 1);
});
