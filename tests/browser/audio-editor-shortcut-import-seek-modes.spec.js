/* SPDX-License-Identifier: AGPL-3.0-only */
import { expect, test, halfMinuteTone } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, importFiles } from './audio-editor-test-helpers.js';

async function importReview(page, editor, xml) {
	await chooseCommandAction(page, editor, 'Edit', 'Preferences');
	const preferences = page.getByRole('dialog', { name: 'Editor preferences', exact: true });
	await preferences.getByRole('tab', { name: /Keyboard shortcuts$/u }).click();
	const choosing = page.waitForEvent('filechooser');
	await preferences.getByRole('button', { name: 'Import Audacity shortcuts', exact: true }).click();
	await (await choosing).setFiles({ name: 'audacity.xml', mimeType: 'application/xml', buffer: Buffer.from(xml) });
	return { preferences, review: preferences.getByRole('region', { name: 'Audacity shortcut import', exact: true }) };
}

for (const [command, xml] of [
	['SeekRightLong', '<audacitykeyboard audacityversion="3.7.7"><command name="SeekRightLong" key="Ctrl+Alt+Shift+F7"/></audacitykeyboard>'],
	['seek-left-long', '<Shortcuts><SC><key>seek-left-long</key><seq>Ctrl+Alt+Shift+F7</seq></SC></Shortcuts>'],
]) test(`shortcut import refuses ${command} without assigning a selection or all-state cursor command`, async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	const { preferences, review } = await importReview(page, editor, xml);
	await expect(review.getByRole('status')).toHaveText('0 commands ready to import; 1 skipped.');
	await expect(review.getByRole('button', { name: 'Apply shortcuts', exact: true })).toBeDisabled();
	await review.getByText('Skipped shortcuts', { exact: true }).click();
	await expect(review.getByRole('listitem')).toHaveText(`${command}: Command unavailable`);
	await preferences.getByRole('button', { name: 'Close', exact: true }).last().click();
	const start = editor.getByRole('group', { name: 'Selection start', exact: true }).locator('.timecode__display');
	const before = await start.textContent();
	await editor.getByRole('group', { name: 'Playhead', exact: true }).focus();
	await page.keyboard.press('Control+Alt+Shift+F7');
	await expect(start).toHaveText(before);
});

test('a supported native one-second seek still imports and moves live playback without changing selection', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [halfMinuteTone]);
	const { preferences, review } = await importReview(page, editor,
		'<audacitykeyboard audacityversion="3.7.7"><command name="SeekRightShort" key="Ctrl+Alt+Shift+F7"/></audacitykeyboard>');
	await expect(review.getByRole('status')).toHaveText('1 command ready to import; 0 skipped.');
	await review.getByRole('button', { name: 'Apply shortcuts', exact: true }).click();
	await preferences.getByRole('button', { name: 'Close', exact: true }).last().click();
	const playhead = editor.getByRole('group', { name: 'Playhead', exact: true });
	const display = playhead.locator('.timecode__display');
	const end = editor.getByRole('group', { name: 'Selection end', exact: true }).locator('.timecode__display');
	await editor.getByRole('button', { name: 'Play', exact: true }).click();
	const seconds = async () => {
		const match = /^(\d+)h(\d+)m([\d.]+)s$/u.exec(await display.textContent());
		expect(match).not.toBeNull();
		return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
	};
	await expect.poll(seconds).toBeGreaterThan(0.05);
	const selection = await end.textContent();
	await playhead.focus();
	const observation = await display.evaluateHandle(element => {
		const read = () => { const match = /^(\d+)h(\d+)m([\d.]+)s$/u.exec(element.textContent); return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]); };
		let origin = null, jump = 0;
		const keydown = event => { if (event.key === 'F7' && event.ctrlKey && event.altKey && event.shiftKey) origin = { seconds: read(), time: performance.now() }; };
		const observer = new MutationObserver(() => { if (origin) jump = Math.max(jump, read() - origin.seconds - (performance.now() - origin.time) / 1000); });
		window.addEventListener('keydown', keydown, true);
		observer.observe(element, { childList: true, characterData: true, subtree: true });
		return { get jump() { return jump; }, close() { observer.disconnect(); window.removeEventListener('keydown', keydown, true); } };
	});
	try {
		await page.keyboard.press('Control+Alt+Shift+F7');
		await expect.poll(() => observation.evaluate(value => value.jump)).toBeGreaterThan(0.7);
	} finally { await observation.evaluate(value => value.close()); await observation.dispose(); }
	await expect(end).toHaveText(selection);
	await editor.getByRole('button', { name: 'Stop', exact: true }).click();
});
