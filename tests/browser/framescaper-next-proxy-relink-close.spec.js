/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, stubStorageEstimate, closeDialog } from './audio-editor-test-helpers.js';
import { installDesktopSpeedWarmupManifest } from './helpers/desktop-speed-warmup-fixture.js';
import { createDeterministicSilentVideoFixture } from './fixtures/deterministic-av-media.js';

async function binding(page) {
	return await page.evaluate(async () => {
		const database = await new Promise((resolve, reject) => {
			const request = indexedDB.open('kw-media-framescaper-editor-v1');
			request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
		});
		try {
			return await new Promise((resolve, reject) => {
				const read = database.transaction('linkedVideoOriginalBindings').objectStore('linkedVideoOriginalBindings').getAll();
				read.onsuccess = () => resolve(read.result[0]?.binding ?? null); read.onerror = () => reject(read.error);
			});
		} finally { database.close(); }
	});
}

test('closing an outgoing original relink cannot overwrite a newer file choice', async ({ page }) => {
	test.setTimeout(90_000);
	const original = createDeterministicSilentVideoFixture('camera.webm');
	await stubStorageEstimate(page, { usage: 1024 ** 2, quota: 2 * 1024 ** 3 });
	await page.addInitScript(() => {
		Object.defineProperty(navigator.storage, 'persisted', { configurable: true, value: async () => true });
	});
	await installDesktopLinkedVideoFixture(page, { original, changed: original });
	const editor = await bootEditor(page, '/framescaper/embed/en/');
	await editor.getByRole('button', { name: 'Link video', exact: true }).click();
	const card = editor.locator('[data-project-bin-item]').first(); await expect(card).toBeVisible();
	await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');
	const open = async () => {
		await card.getByRole('button', { name: /More file actions:/u }).click();
		await page.getByRole('menuitem', { name: 'Video proxies', exact: true }).click();
	};
	await open();
	const dialog = page.getByRole('dialog', { name: 'Video proxies', exact: true });
	await page.evaluate(() => {
		globalThis.__videoProxyDesktopFixture.choice = '2'; globalThis.__videoProxyDesktopFixture.holdExact = true;
	});
	await dialog.getByRole('button', { name: 'Relink original', exact: true }).click();
	await expect.poll(() => page.evaluate(() => globalThis.__videoProxyDesktopFixture.held)).toBe(true);
	await closeDialog(dialog); await open();
	await page.evaluate(() => { globalThis.__videoProxyDesktopFixture.choice = '3'; });
	await dialog.getByRole('button', { name: 'Relink original', exact: true }).click();
	await expect(dialog.locator('[role="status"]').last()).toHaveText('Original video relinked.');
	await expect.poll(async () => (await binding(page))?.locatorId).toBe('3'.repeat(64));
	await page.evaluate(() => globalThis.__releaseRelink());
	// Wait for either abandoned-locator cleanup or the original stale publication, never an arbitrary delay.
	await expect.poll(async () => await page.evaluate(() => globalThis.__videoProxyDesktopFixture.releases.includes('2'.repeat(64)))
		|| (await binding(page))?.locatorId === '2'.repeat(64)).toBe(true);
	expect((await binding(page)).locatorId).toBe('3'.repeat(64));
});

async function installDesktopLinkedVideoFixture(page, { original, changed }) {
	const files = {
		initial: desktopFixtureFile(original, '1', 'a', 'd'),
		exact: desktopFixtureFile({ ...original, name: 'linked-proxy-exact.webm' }, '2', 'b', 'e'),
		changed: desktopFixtureFile(changed, '3', 'c', 'f'),
		proxy: desktopFixtureFile({ ...original, name: 'linked-existing-proxy.webm' }, '4', 'a', '9'),
	};
	const filesByKey = Object.fromEntries(Object.values(files).map((file) => [file.key, file]));
	await page.route('**/__e2e-video-proxy-file/*', async (route) => {
		const key = new URL(route.request().url()).pathname.split('/').at(-1);
		const file = filesByKey[key];
		if (!file) return route.abort();
		return route.fulfill({
			body: Buffer.from(file.base64, 'base64'),
			contentType: file.mimeType,
			headers: { 'Content-Length': String(file.size) },
		});
	});
	await installDesktopSpeedWarmupManifest(page);
	await page.addInitScript((records) => {
		const filesByKey = Object.fromEntries(records.map((record) => [record.key, record]));
		const filesByLocator = Object.fromEntries(records.map((record) => [record.locatorId, record]));
		let release; const hold = new Promise(resolve => { release = resolve; });
		const state = { choice: '1', choices: 0, loads: [], releases: [], held: false, holdExact: false, offline: false, saveSessionOpened: 0 };
		globalThis.__releaseRelink = release;
		const descriptor = (record) => ({
			id: record.readId,
			readProfile: 'materialized-v1',
			url: `${location.origin}/__e2e-video-proxy-file/${record.key}`,
			name: record.name,
			size: record.size,
			mimeType: record.mimeType,
			lastModified: 123,
		});
		const choice = (record) => ({
			locatorId: record.locatorId,
			locatorRevision: record.locatorRevision,
			name: record.name,
			size: record.size,
			mimeType: record.mimeType,
			lastModified: 123,
		});
		const bridge = Object.freeze({
			chooseLinkedVideoOriginal: async () => {
				state.choices += 1;
				return choice(filesByKey[state.choice]);
			},
			loadLinkedVideoOriginal: async (request) => {
				state.loads.push(structuredClone(request));
				if (state.holdExact && request.locatorId === filesByKey['2'].locatorId) { state.held = true; await hold; }
				if (request.playback) return null;
				if (state.offline && request.locatorId === filesByKey['1'].locatorId) return null;
				const record = filesByLocator[request.locatorId];
				if (!record) return null;
				return { locatorRevision: record.locatorRevision, descriptor: descriptor(record) };
			},
			reconcileLinkedVideoOriginals: async () => 0,
			releaseLinkedVideoOriginal: async reference => { state.releases.push(reference.locatorId); return true; },
			chooseFiles: async (request) => request.purpose === 'video'
				? [descriptor(filesByKey['4'])] : [],
			getDesktopVideoExportCapabilities: async () => ({ schemaVersion: 1, formats: {
				mp4: { available: true, provider: 'external-ffmpeg', reason: null },
				webm: { available: true, provider: 'external-ffmpeg', reason: null },
			} }),
			chooseSaveTarget: async (request) => ({ id: 'proxy-export-target', name: request.suggestedName }),
			beginWrite: async () => {
				state.saveSessionOpened += 1;
				throw new Error('Video delivery reached encoding without its original.');
			},
			writeChunk: async () => { throw new Error('Unexpected video output chunk.'); },
			finishWrite: async () => { throw new Error('Unexpected video output commit.'); },
		});
		Object.defineProperty(globalThis, '__videoProxyDesktopFixture', {
			configurable: true,
			value: state,
		});
		Object.defineProperty(globalThis, 'framescaperDesktop', {
			configurable: true,
			enumerable: true,
			value: Object.freeze({ v1: bridge }),
		});
	}, Object.values(files));
}

function desktopFixtureFile(file, locatorDigit, revisionDigit, readDigit) {
	return {
		key: locatorDigit,
		name: file.name,
		mimeType: file.mimeType,
		base64: file.buffer.toString('base64'),
		size: file.buffer.byteLength,
		locatorId: locatorDigit.repeat(64),
		locatorRevision: revisionDigit.repeat(64),
		readId: readDigit.repeat(64),
	};
}

