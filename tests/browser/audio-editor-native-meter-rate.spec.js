/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, waitForEditor } from './audio-editor-test-helpers.js';
import { installNativeInputPeer } from './helpers/native-input-peer.js';
import { NATIVE_OUTPUT_PEER_WEBKIT_REASON } from './helpers/native-output-peer.js';

test('WASAPI keeps enough transport frames in flight at higher sample rates', async ({ page, browserName }) => {
	test.skip(browserName === 'webkit', NATIVE_OUTPUT_PEER_WEBKIT_REASON);
	await installNativeInputPeer(page, { backend: 'wasapi' });
	const editor = await bootEditor(page, '/embed/en/');
	await editor.getByRole('button', { name: 'Audio setup', exact: true }).click();
	const setup = editor.getByRole('dialog', { name: 'Audio setup', exact: true });
	await setup.getByRole('combobox', { name: 'Host', exact: true }).selectOption('wasapi');
	const rate = setup.getByRole('combobox', { name: 'Recording sample rate', exact: true });
	const requestedPeriods = sampleRate => page.evaluate(sampleRate => window.__nativeInputPeer.requests
		.filter(request => request.mode === 'shared' && request.sampleRate === sampleRate)
		.map(request => [request.direction, request.periodFrames]), sampleRate);
	await expect.poll(() => requestedPeriods(48_000)).toEqual([['input', 256], ['output', 256]]);
	await expect(rate).toBeEnabled();
	await rate.selectOption('96000');
	await expect.poll(() => requestedPeriods(96_000)).toEqual([['input', 512], ['output', 512]]);
	await expect(rate).toBeEnabled();
	await rate.selectOption('192000');
	await expect.poll(() => requestedPeriods(192_000)).toEqual([['input', 1024], ['output', 1024]]);
	await expect(rate).toBeEnabled();
	await expect(editor.getByRole('alert')).toHaveCount(0);
});

test('idle microphone metering retains its preference and adopts the reconnected native input rate', async ({ page }) => {
	await installNativeInputPeer(page);
	const editor = await bootEditor(page, '/embed/en/');
	await editor.getByRole('button', { name: 'Audio setup', exact: true }).click();
	const setup = editor.getByRole('dialog', { name: 'Audio setup', exact: true });
	await setup.getByRole('combobox', { name: 'Host', exact: true }).selectOption('alsa');
	await expect(setup.getByRole('combobox', { name: 'Recording sample rate', exact: true })).toBeEnabled();
	await page.keyboard.press('Escape');
	await editor.getByRole('button', { name: 'Record level', exact: true }).first().click();
	const metering = page.getByRole('checkbox', { name: 'Show mic metering when not recording', exact: true });
	await metering.click(); await expect(metering).toBeChecked();
	await page.keyboard.press('Escape');
	const meter = editor.getByRole('meter', { name: 'Input level', exact: true });
	await expect.poll(async () => Number(await meter.getAttribute('aria-valuenow'))).toBeGreaterThan(-25);
	await editor.getByRole('button', { name: 'Audio setup', exact: true }).click();
	const rate = setup.getByRole('combobox', { name: 'Recording sample rate', exact: true });
	await rate.selectOption('44100'); await expect(rate).toBeEnabled();
	await expect.poll(() => page.evaluate(() => window.__nativeInputPeer.requests.filter(request => request.direction === 'input').at(-1)?.sampleRate)).toBe(44100);
	await expect.poll(() => page.evaluate(() => window.__nativeInputPeer.contexts.filter(context => context.state !== 'closed').map(context => context.sampleRate))).toEqual([44100]);
	await page.keyboard.press('Escape');
	await editor.getByRole('button', { name: 'Record level', exact: true }).first().click();
	await expect(metering).toBeChecked();
	await page.keyboard.press('Escape');
	// The helper deliberately lowers the new native source by20dB, so a stale
	// analyser cannot masquerade as a resumed meter on the new route.
	await expect.poll(async () => Number(await meter.getAttribute('aria-valuenow'))).toBeLessThan(-28);
	await expect.poll(async () => Number(await meter.getAttribute('aria-valuenow'))).toBeGreaterThan(-45);
	await expect(editor.getByRole('alert')).toHaveCount(0);
	await expect.poll(() => page.evaluate(async () => {
		const opened = indexedDB.open('kw-media-soundscaper-editor-v1');
		const database = await new Promise((resolve, reject) => { opened.onsuccess = () => { resolve(opened.result); }; opened.onerror = () => { reject(opened.error); }; });
		try {
			const request = database.transaction('settings').objectStore('settings').get('microphone-metering');
			return await new Promise((resolve, reject) => { request.onsuccess = () => { resolve(request.result?.value); }; request.onerror = () => { reject(request.error); }; });
		} finally { database.close(); }
	})).toBe(true);
	await page.reload(); await waitForEditor(page);
	await editor.getByRole('button', { name: 'Audio setup', exact: true }).click();
	await expect(setup.getByRole('combobox', { name: 'Host', exact: true })).toHaveValue('alsa');
	await expect(rate).toBeEnabled(); await expect(rate).toHaveValue('44100');
	await page.keyboard.press('Escape');
	await editor.getByRole('button', { name: 'Record level', exact: true }).first().click();
	await expect(metering).toBeChecked();
	await page.keyboard.press('Escape');
	await expect.poll(async () => Number(await meter.getAttribute('aria-valuenow'))).toBeLessThan(-28);
	await expect.poll(async () => Number(await meter.getAttribute('aria-valuenow'))).toBeGreaterThan(-45);
	await expect(editor.getByRole('alert')).toHaveCount(0);
});
