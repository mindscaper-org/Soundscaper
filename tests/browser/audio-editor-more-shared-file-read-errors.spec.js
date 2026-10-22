/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, toneA } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, clipByName } from './audio-editor-test-helpers.js';

for (const failure of ['lookup', 'read']) test(`OS share opens its healthy recordings despite a cache ${failure} failure`, async ({ page }) => {
	const initialEditor = await bootEditor(page, '/embed/en/');
	await chooseCommandAction(page, initialEditor, 'Window', 'Project bin');
	await expect(initialEditor.getByRole('heading', { name: 'Project bin', exact: true })).toBeHidden();
	const token = 'b'.repeat(32);
	// Keep a passive producer alive while the recipient navigates: WebKit's
	// ephemeral cache drops entries when its last owning document leaves.
	const staging = await page.context().newPage();
	const stagingUrl = new URL('/__share-file-cache-staging', page.url()).href;
	await staging.route(stagingUrl, route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Share cache staging</title>' }));
	await staging.goto(stagingUrl);
	try {
		await staging.evaluate(async ({ token, base64 }) => {
			const cache = await caches.open('soundscaper-shared-files-v1');
			const bytes = Uint8Array.from(atob(base64), character => character.charCodeAt(0));
			await cache.put(`/.soundscaper/share/${token}.json`, Response.json({ schemaVersion: 1,
				files: ['before.wav', 'unreadable.wav', 'after.wav'].map(name => ({ name, type: 'audio/wav', byteLength: bytes.length })) }));
			for (let index = 0; index < 3; index++) await cache.put(`/.soundscaper/share/${token}/${index}`, new Response(bytes));
		}, { token, base64: toneA.buffer.toString('base64') });
		await page.addInitScript(({ token, failure }) => {
			const original = Cache.prototype.match;
			Cache.prototype.match = function (request, options) {
				const url = new URL(typeof request === 'string' ? request : request.url, location.href);
				if (url.pathname === `/.soundscaper/share/${token}/1`) {
					const error = new DOMException('The shared recording could not be read from browser storage.', 'NotReadableError');
					if (failure === 'lookup') return Promise.reject(error);
					return Promise.resolve(new Response(new ReadableStream({ pull() { throw error; } })));
				}
				return original.call(this, request, options);
			};
		}, { token, failure });
		const address = new URL(page.url()); address.searchParams.set('share', token);
		await page.goto(address.href);
		const editor = page.locator('[data-audio-editor]');
		await expect(editor).toHaveAttribute('data-clip-count', '2', { timeout: 15_000 });
		await expect(clipByName(editor, 'before.wav')).toBeVisible();
		await expect(clipByName(editor, 'after.wav')).toBeVisible();
		await expect.poll(() => page.evaluate(async () => (await (await caches.open('soundscaper-shared-files-v1')).keys()).length)).toBe(0);
	} finally { await staging.close(); }
});
