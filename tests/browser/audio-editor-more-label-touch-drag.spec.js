/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, importFiles } from './audio-editor-test-helpers.js';

for (const point of [false, true]) test(`an imported ${point ? 'point' : 'caption'} label moves with native touch and supports Undo`, async ({ page, browserName }) => {
	test.skip(browserName !== 'chromium', 'Native touch uses the Chromium input protocol.');
	const editor = await bootEditor(page, '/embed/en/');
	const file = point ? { name: 'Points.txt', mimeType: 'text/plain', buffer: Buffer.from('1\t1\tCaption\n') }
		: { name: 'Caption.srt', mimeType: 'application/x-subrip', buffer: Buffer.from('1\n00:00:01,000 --> 00:00:02,000\nCaption\n') };
	await importFiles(editor, [file]);
	const label = editor.getByRole('group', { name: 'Edit labels: Caption', exact: true });
	await expect(label).toBeVisible();
	const left = () => label.evaluate(element => element.getBoundingClientRect().left);
	const initial = await left();
	const control = label.locator(point ? '.label-marker__left-stalk' : '.label-marker__label-box');
	const bounds = await control.boundingBox();
	expect(bounds).not.toBeNull();
	const first = { x: bounds.x + bounds.width / 2, y: bounds.y + Math.min(bounds.height / 2, point ? 40 : 10), id: 1 };
	const native = await page.context().newCDPSession(page);
	await native.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [first] });
	await native.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ ...first, x: first.x + 30 }] });
	await expect.poll(left).toBeCloseTo(initial + 30, 0);
	await native.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
	await expect.poll(left).toBeCloseTo(initial + 30, 0);
	await chooseCommandAction(page, editor, 'Edit', 'Undo');
	await expect.poll(left).toBeCloseTo(initial, 0);
	await chooseCommandAction(page, editor, 'Edit', 'Redo');
	await expect.poll(left).toBeCloseTo(initial + 30, 0);
	await expect(editor.locator('.audio-editor-alert-overlay')).toHaveCount(0);
});
