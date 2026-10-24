/* SPDX-License-Identifier: AGPL-3.0-only */

import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseNestedCommandAction, collectClientErrors, importFiles } from './audio-editor-test-helpers.js';

async function uploadApi(page) {
	const uploads = [];
	let account = 'original-recorder';
	await page.route('**/api/freesound/**', async route => {
		const request = route.request(), path = new URL(request.url()).pathname;
		if (path === '/api/freesound/oauth/session') return route.fulfill({ json: { data: { connected: request.method() !== 'DELETE', user: { id: account === 'original-recorder' ? 1 : 2, username: account } } } });
		if (path === '/api/freesound/uploads/pending') return route.fulfill({ json: { data: { pendingDescription: [], pendingProcessing: [], pendingModeration: [] } } });
		if (path === '/api/freesound/uploads') {
			uploads.push({ name: decodeURIComponent(request.headers()['x-freesound-filename']), bytes: request.postDataBuffer() });
			return route.fulfill({ status: 201, json: { data: { uploadFilename: `remote-${uploads.length}.wav` } } });
		}
		if (path === '/api/freesound/uploads/describe') return route.fulfill({ status: 202, json: { data: { soundId: 42, status: 'pending_moderation' } } });
		if (path === '/api/freesound/oauth/start') return route.fulfill({ json: { data: {
			attemptId: 'replacement', handoffToken: 'replacement-handoff', expiresAt: new Date(Date.now() + 60_000).toISOString(),
			authorizeUrl: 'https://freesound.org/apiv2/oauth2/authorize/?client_id=ordinary&redirect_uri=https%3A%2F%2Fsoundscaper.org%2Fapi%2Ffreesound%2Foauth%2Fcallback&response_type=code&state=replacement',
		} } });
		if (path === '/api/freesound/oauth/poll') {
			account = 'replacement-recorder';
			return route.fulfill({ json: { data: { connected: true, user: { id: 2, username: account } } } });
		}
		return route.fulfill({ status: 404, json: {} });
	});
	await page.context().route('https://freesound.org/apiv2/oauth2/authorize/**', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Connect</title>' }));
	return uploads;
}

async function holdNativeDecode(page) {
	await page.addInitScript(() => {
		const Context = globalThis.AudioContext ?? globalThis.webkitAudioContext;
		const decode = Context.prototype.decodeAudioData;
		Context.prototype.decodeAudioData = function (...args) {
			const pending = Reflect.apply(decode, this, args);
			if (!globalThis.__next200HoldDecode) return pending;
			globalThis.__next200HoldDecode = false;
			return pending.then(audio => new Promise(resolve => {
				globalThis.__next200ReleaseDecode = () => { globalThis.__next200ReleaseDecode = null; resolve(audio); };
			}));
		};
	});
}

for (const retire of ['Cancel', 'Disconnect']) test(`Freesound ${retire} releases later uploads while a native conversion is held`, async ({ page }) => {
	const errors = collectClientErrors(page);
	const uploads = await uploadApi(page);
	await holdNativeDecode(page);
	const editor = await bootEditor(page, '/embed/en/');
	await chooseCommandAction(page, editor, 'Window', 'Freesound');
	const panel = editor.locator('[data-workspace-panel="freesound"]');
	await expect(panel.getByText('Connected as original-recorder', { exact: true })).toBeVisible();
	let queue = panel.locator('[data-freesound-uploads]');
	await queue.getByText('Upload to Freesound', { exact: true }).click();
	await page.evaluate(() => { globalThis.__next200HoldDecode = true; });
	await queue.locator('input[type="file"]').setInputFiles([
		createWavFixture({ name: 'Held conversion.wave', duration: .05 }),
		...(retire === 'Cancel' ? [createWavFixture({ name: 'Fresh recording.wav', duration: .05 })] : []),
	]);
	await expect.poll(() => page.evaluate(() => typeof globalThis.__next200ReleaseDecode)).toBe('function');
	if (retire === 'Cancel') {
		await queue.getByRole('button', { name: /^Cancel upload\s*:\s*Held conversion\.wave$/u }).click();
		await expect(queue.locator('[data-upload-status="cancelled"]')).toContainText('Held conversion.wave');
	} else {
		await panel.getByRole('button', { name: 'Disconnect', exact: true }).click();
		const popupReady = page.waitForEvent('popup');
		await panel.getByRole('button', { name: 'Connect to Freesound', exact: true }).click();
		const popup = await popupReady;
		await expect(panel.getByText('Connected as replacement-recorder', { exact: true })).toBeVisible();
		await popup.close();
		queue = panel.locator('[data-freesound-uploads]');
		await queue.getByText('Upload to Freesound', { exact: true }).click();
		await queue.locator('input[type="file"]').setInputFiles(createWavFixture({ name: 'Fresh recording.wav', duration: .05 }));
	}
	await expect(queue.locator('[data-upload-status="ready-to-publish"]')).toContainText('Fresh recording.wav');
	expect(uploads.map(upload => upload.name)).toEqual(['Fresh recording.wav']);
	await page.evaluate(() => globalThis.__next200ReleaseDecode());
	await expect(queue.locator('li')).toHaveCount(retire === 'Cancel' ? 2 : 1);
	await expect(queue.locator('[data-upload-status="ready-to-publish"]')).toHaveCount(1);
	expect(errors).toEqual([]);
});

test('a submitted clip can be edited and uploaded again with fresh PCM', async ({ page }) => {
	const errors = collectClientErrors(page);
	const uploads = await uploadApi(page);
	// WebKit does not expose Blob upload bytes through Request.postDataBuffer.
	// Observe the actual File supplied to fetch while retaining native transfer.
	await page.addInitScript(() => {
		const nativeFetch = globalThis.fetch;
		globalThis.__next200UploadDigests = [];
		globalThis.fetch = async (...args) => {
			const [input, options] = args;
			if (String(input).endsWith('/api/freesound/uploads') && options?.body instanceof Blob) {
				const hash = await crypto.subtle.digest('SHA-256', await options.body.arrayBuffer());
				globalThis.__next200UploadDigests.push(Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join(''));
			}
			return Reflect.apply(nativeFetch, globalThis, args);
		};
	});
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [createWavFixture({ name: 'Field recording.wav', duration: .1 })]);
	await chooseCommandAction(page, editor, 'Window', 'Freesound');
	const panel = editor.locator('[data-workspace-panel="freesound"]');
	await expect(panel.getByText('Connected as original-recorder', { exact: true })).toBeVisible();
	const queue = panel.locator('[data-freesound-uploads]');
	const uploadClip = async () => {
		await editor.locator('[data-clip-id]').focus();
		await page.keyboard.press('Shift+F10');
		await page.locator('.audio-editor-clip-context-menu').getByRole('menuitem', { name: 'Upload clip to Freesound', exact: true }).press('Enter');
	};
	await uploadClip();
	await queue.getByRole('button', { name: /^Ready to publish\s*:/u }).click();
	const dialog = page.getByRole('dialog', { name: 'Publish to Freesound', exact: true });
	await dialog.getByRole('textbox', { name: 'Description', exact: true }).fill('My field recording.');
	await dialog.getByRole('textbox', { name: 'Tags', exact: true }).fill('field, recording, audio');
	await dialog.getByLabel(/I confirm that I have the rights/u).check();
	await dialog.getByRole('button', { name: 'Publish', exact: true }).click();
	await expect(dialog).toHaveCount(0);
	await expect(queue.locator('[data-upload-status="submitted"]')).toHaveCount(1);
	await editor.locator('[data-clip-id] .clip-header').click();
	await chooseNestedCommandAction(page, editor, 'Effect', ['Special', 'Invert']);
	await expect(editor.locator('[data-status]')).toHaveAttribute('data-state', 'success');
	await uploadClip();
	await expect(queue.locator('[data-upload-status="ready-to-publish"]')).toHaveCount(1);
	expect(uploads).toHaveLength(2);
	const digests = await page.evaluate(() => globalThis.__next200UploadDigests);
	expect(digests).toHaveLength(2);
	expect(digests[0]).not.toBe(digests[1]);
	expect(errors).toEqual([]);
});
