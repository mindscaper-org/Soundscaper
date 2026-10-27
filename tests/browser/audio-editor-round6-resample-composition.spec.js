/* SPDX-License-Identifier: AGPL-3.0-only */

import { expectClipSampleRate, resampleClipFormat } from './audio-editor-clip-settings-test-helpers.js';
import { expect, test, toneA } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, clipByName, closeWorkspacePanel, importFiles, openClipProperties } from './audio-editor-test-helpers.js';

test('the clip format field keeps native composition as a draft until its conversion button is pressed', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [toneA]);
	const imported = clipByName(editor, toneA.name);
	const clipId = await imported.getAttribute('data-clip-id');
	expect(clipId).not.toBeNull();
	const clip = editor.locator(`[data-clip-id="${clipId}"][role="group"]`);
	const properties = await openClipProperties(page, editor, clip);
	await resampleClipFormat(properties, 24_000);
	const rate = properties.getByRole('spinbutton', { name: 'Sample rate (Hz)', exact: true });
	await rate.fill('32000');
	const prevented = await rate.evaluate(field => {
		const event = new KeyboardEvent('keydown', {
			key: 'Enter', code: 'Enter', bubbles: true, cancelable: true, isComposing: true,
		});
		field.dispatchEvent(event);
		return event.defaultPrevented;
	});
	expect(prevented).toBe(false);
	await expect(rate).toBeFocused();
	await expect(properties.getByRole('button', { name: 'Resample', exact: true })).toBeEnabled();
	await expect(properties.locator('[data-clip-source-sample-rate]')).toHaveAttribute('data-clip-source-sample-rate', '24000');
	await resampleClipFormat(properties, 48_000);
	await closeWorkspacePanel(editor, 'clip-properties');
	await chooseCommandAction(page, editor, 'Edit', 'Undo');
	const restored = await openClipProperties(page, editor, clip);
	await expectClipSampleRate(restored, 24_000);
});
