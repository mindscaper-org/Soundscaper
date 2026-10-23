/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, getMenuItem, openNestedCommandMenu } from './audio-editor-test-helpers.js';

test('a scheduled recording keeps blocked Freesound file drags from navigating away', async ({ page }) => {
	let uploaded = 0;
	await page.route('**/api/freesound/**', async route => {
		const path = new URL(route.request().url()).pathname;
		if (path.endsWith('/uploads')) uploaded++;
		await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ data: path.endsWith('/oauth/session')
			? { connected: true, user: { id: 7, username: 'field-recorder' } }
			: { pendingDescription: [], pendingProcessing: [], pendingModeration: [] } }) });
	});
	await page.addInitScript(() => {
		Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: {
			enumerateDevices: async () => [],
			getUserMedia: async () => {
				const context = new AudioContext({ sampleRate: 48_000 });
				const destination = context.createMediaStreamDestination();
				const track = destination.stream.getAudioTracks()[0];
				const stop = track.stop.bind(track);
				Object.defineProperties(track, {
					getSettings: { configurable: true, value: () => ({ channelCount: 2, sampleRate: context.sampleRate }) },
					stop: { configurable: true, value: () => { stop(); void context.close().catch(() => undefined); } },
				});
				await context.resume();
				return destination.stream;
			},
		} });
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
	await editor.getByRole('button', { name: 'Record options', exact: true }).click();
	await page.getByRole('dialog', { name: 'Record options', exact: true })
		.getByRole('button', { name: 'Timed recording', exact: true }).click();
	const dialog = page.getByRole('dialog', { name: 'Set up timed recording', exact: true });
	const future = new Date(Date.now() + 3_600_000);
	const local = new Date(future.getTime() - future.getTimezoneOffset() * 60_000).toISOString().slice(0, 19);
	await dialog.locator('input[type="datetime-local"]').first().fill(local);
	await dialog.getByRole('button', { name: 'Schedule recording', exact: true }).click();
	await expect(dialog).toBeHidden();
	await expect(uploads.getByRole('button', { name: 'Choose audio files', exact: true })).toBeDisabled();
	await expect.poll(dragCancelled).toBe(true);
	expect(uploaded).toBe(0);
	await editor.getByRole('button', { name: 'Cancel scheduled recording', exact: true }).click();
});
