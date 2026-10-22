/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseNestedCommandAction, disableNativeSavePicker, downloadBytes } from './audio-editor-test-helpers.js';
import { createDeterministicSilentVideoFixture } from './fixtures/deterministic-av-media.js';
import { seekFramescaperTimecode } from './helpers/framescaper-standard-timecode.js';
import { referenceTopClipId } from '../helpers/interchange-top-clip.ts';

test('OTIO keeps the incoming clip on top through an ordinary three-clip overlap chain', async ({ page }) => {
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/framescaper/embed/en/');
	await editor.locator('[data-project-bin-input]').setInputFiles(createDeterministicSilentVideoFixture('Camera.webm'));
	const card = editor.getByRole('listitem', { name: 'Project bin: Camera', exact: true });
	const add = card.getByRole('button', { name: /Add to timeline/u }); await add.click();
	const clips = editor.getByRole('group', { name: /^Video clip:/u }); await expect(clips).toHaveCount(1);
	await clips.first().press('Enter'); await seekFramescaperTimecode(page, editor, '00:00:00:15'); await add.click();
	await expect(clips).toHaveCount(2);
	await clips.last().press('Enter'); await seekFramescaperTimecode(page, editor, '00:00:01:00'); await add.click();
	await expect(clips).toHaveCount(3);
	const ids = await clips.evaluateAll(elements => elements.map(element => element.getAttribute('data-clip-id')));
	const rows = await clips.evaluateAll(elements => elements.map(element => element.closest('[data-track-row]')?.getAttribute('data-track-id')));
	expect(new Set(rows).size).toBe(1);
	const boxes = await clips.evaluateAll(elements => elements.map(element => ({ x: element.getBoundingClientRect().x, width: element.getBoundingClientRect().width })));
	expect(boxes[1].x).toBeLessThan(boxes[0].x + boxes[0].width);
	expect(boxes[2].x).toBeGreaterThan(boxes[0].x + boxes[0].width);
	expect(boxes[2].x).toBeLessThan(boxes[1].x + boxes[1].width);
	const exporting = page.waitForEvent('download');
	await chooseNestedCommandAction(page, editor, 'File', ['Export other', 'Export OpenTimelineIO']);
	const text = new TextDecoder().decode(await downloadBytes(await exporting));
	await test.info().attach('timeline.otio', { body: text, contentType: 'application/json' });
	expect(referenceTopClipId(text, 23, 30)).toBe(ids[1]);
	expect(referenceTopClipId(text, 38, 30)).toBe(ids[2]);
});
