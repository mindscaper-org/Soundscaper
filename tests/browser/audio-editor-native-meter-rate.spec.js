/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, waitForEditor } from './audio-editor-test-helpers.js';
import { installNativeInputPeer } from './helpers/native-input-peer.js';

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
