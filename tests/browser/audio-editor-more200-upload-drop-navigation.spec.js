/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, getMenuItem, openNestedCommandMenu, waitForEditor } from './audio-editor-test-helpers.js';

test('a read-only project keeps blocked Freesound file drags from navigating away', async ({ page, context }) => {
	let uploaded = 0;
	await page.route('**/api/freesound/**', async route => {
		const path = new URL(route.request().url()).pathname;
		if (path.endsWith('/uploads')) uploaded++;
		await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ data: path.endsWith('/oauth/session')
			? { connected: true, user: { id: 7, username: 'field-recorder' } }
			: { pendingDescription: [], pendingProcessing: [], pendingModeration: [] } }) });
	});
	const editor = await bootEditor(page, '/embed/en/');
	await getMenuItem(await openNestedCommandMenu(page, editor, 'Window', []), 'Freesound').click();
	const uploads = editor.locator('[data-freesound-uploads]');
	await expect(uploads).toBeAttached();
	await uploads.locator('summary').click();
	const drop = uploads.locator('[data-freesound-upload-drop]');
	const dragCancelled = () => drop.evaluate(element => {
		const transfer = new DataTransfer();
		transfer.items.add(new File(['audio'], 'field-take.wav', { type: 'audio/wav' }));
		const event = new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: transfer });
		element.dispatchEvent(event);
		return event.defaultPrevented;
	});
	await expect.poll(dragCancelled).toBe(true);
	// A second ordinary editor takes the live document lock. The original tab
	// stays inspectable with its upload surface present and edits disabled.
	const other = await context.newPage();
	try {
		await other.goto('/embed/en/');
		await waitForEditor(other);
		await expect(editor).toHaveAttribute('data-edit-block-reason', 'read-only');
		await expect(uploads.getByRole('button', { name: 'Choose audio files', exact: true })).toBeDisabled();
		await expect.poll(dragCancelled).toBe(true);
		expect(uploaded).toBe(0);
	} finally { await other.close(); }
});
