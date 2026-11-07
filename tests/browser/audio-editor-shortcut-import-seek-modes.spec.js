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
	await expect(preferences.getByRole('button', { name: 'Import Audacity shortcuts', exact: true })).toBeEnabled({ timeout: 15_000 });
	return { preferences, review: preferences.getByRole('region', { name: 'Audacity shortcut import', exact: true }) };
}

// Node retains the independent dialect and durable preference cases.
test('shortcut import reviews both long-seek dialects without changing selection', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	for (const [command, xml] of [
		['SeekRightLong', '<audacitykeyboard audacityversion="3.7.7"><command name="SeekRightLong" key="Ctrl+Alt+Shift+F7"/></audacitykeyboard>'],
		['seek-left-long', '<Shortcuts><SC><key>seek-left-long</key><seq>Ctrl+Alt+Shift+F7</seq></SC></Shortcuts>'],
	]) {
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
	}
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
	const observation = await display.evaluateHandle((element, sourceSampleRate) => {
		const read = () => { const match = /^(\d+)h(\d+)m([\d.]+)s$/u.exec(element.textContent); return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]); };
		let origin = null, jump = null;
		const keydown = event => { if (event.key === 'F7' && event.ctrlKey && event.altKey && event.shiftKey) origin = read(); };
		const streams = new Map();
		const postMessage = MessagePort.prototype.postMessage;
		MessagePort.prototype.postMessage = function (message, ...rest) {
			const result = Reflect.apply(postMessage, this, [message, ...rest]);
			// Measure the worklet reschedule itself: elapsed wall time includes graph
			// preparation and coverage overhead that are not part of the seek distance.
			if (origin !== null && message?.type === 'configure-stream' && !message.resample) {
				streams.set(message.streamId, message.startFrame / sourceSampleRate);
			}
			if (message?.type === 'play-stream' && streams.has(message.streamId)) jump = streams.get(message.streamId) - origin;
			return result;
		};
		window.addEventListener('keydown', keydown, true);
		return { get jump() { return jump; }, get target() { return origin + jump; }, close() {
			MessagePort.prototype.postMessage = postMessage;
			window.removeEventListener('keydown', keydown, true);
		} };
	}, halfMinuteTone.buffer.readUInt32LE(24));
	try {
		await page.keyboard.press('Control+Alt+Shift+F7');
		await expect.poll(() => observation.evaluate(value => value.jump)).toBeGreaterThan(0.7);
		expect(await observation.evaluate(value => value.jump)).toBeLessThan(1.3);
		await expect.poll(seconds).toBeGreaterThan(await observation.evaluate(value => value.target) + 0.05);
	} finally { await observation.evaluate(value => value.close()); await observation.dispose(); }
	await expect(end).toHaveText(selection);
	await editor.getByRole('button', { name: 'Stop', exact: true }).click();
});
