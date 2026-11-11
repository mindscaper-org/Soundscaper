/* SPDX-License-Identifier: AGPL-3.0-only */

import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import {
	addRackEffect, bootEditor, chooseCommandAction, chooseNestedCommandAction, clipByName, closeDialog,
	collectClientErrors, commitInput, effectSourceMetadata, importFiles, openEffectsForTrack, registerAudioEditorHooks, waitForEditor,
} from './audio-editor-test-helpers.js';

const controls = [
	['Fundamental frequency', '60'], ['Harmonics', '5'], ['Notch width', '3'], ['Reduction', '30'],
];

async function configure(dialog) {
	for (const [name, value] of controls) {
		const input = dialog.getByRole('spinbutton', { name, exact: true });
		await commitInput(input, value);
		await expect(input).toHaveValue(value);
	}
}

test.describe('Hum removal', () => {
	registerAudioEditorHooks();

	test('previews and applies Hum removal through Noise removal and repair', async ({ page }) => {
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/', { showProjectBin: false });
		const tone = createWavFixture({ name: 'mains-hum.wav', frequency: 60, duration: 8 });
		await importFiles(editor, [tone]);
		await chooseCommandAction(page, editor, 'Select', 'Select all');
		await chooseNestedCommandAction(page, editor, 'Effect', ['Noise removal and repair', 'Hum removal']);
		const dialog = page.getByRole('dialog', { name: 'Apply effect', exact: true });
		await configure(dialog);
		await dialog.getByRole('button', { name: 'Preview', exact: true }).click();
		const stop = dialog.getByRole('button', { name: 'Stop preview', exact: true });
		await expect(stop).toBeVisible();
		await stop.click();
		await expect(dialog.getByRole('button', { name: 'Preview', exact: true })).toBeVisible();
		await dialog.getByRole('button', { name: 'Apply to selection', exact: true }).click();
		await expect(dialog).toBeHidden({ timeout: 20000 });
		await expect.poll(async () => (await effectSourceMetadata(page)).find(source => source.name.includes('Hum removal'))?.frameCount)
			.toBe(48000 * 8);
		await editor.getByRole('button', { name: 'Undo', exact: true }).click();
		await expect(clipByName(editor, tone.name)).toHaveCount(1);
		expect(errors).toEqual([]);
	});

	test('updates a playing realtime rack without rebuilding and restores its controls after reload', async ({ page }) => {
		test.setTimeout(90000);
		await page.addInitScript(() => {
			globalThis.__humRemovalNodes = { created: 0, configured: 0 };
			const NativeNode = globalThis.AudioWorkletNode;
			globalThis.AudioWorkletNode = new Proxy(NativeNode, {
				construct(Constructor, args) {
					const node = Reflect.construct(Constructor, args);
					if (args[1] === 'kw-standard-effect' && args[2]?.processorOptions?.type === 'hum-removal') {
						globalThis.__humRemovalNodes.created++;
						const post = node.port.postMessage.bind(node.port);
						node.port.postMessage = (...messages) => {
							if (messages[0]?.type === 'configure') globalThis.__humRemovalNodes.configured++;
							return post(...messages);
						};
					}
					return node;
				},
			});
		});
		const errors = collectClientErrors(page);
		let editor = await bootEditor(page, '/embed/en/', { showProjectBin: false });
		await importFiles(editor, [createWavFixture({ name: 'live-hum.wav', frequency: 60, duration: 60 })]);
		let panel = await openEffectsForTrack(editor, 1);
		await addRackEffect(page, panel, 'track', 'Hum removal');
		await closeDialog(page.getByRole('dialog', { name: 'Hum removal', exact: true }));
		await editor.getByRole('button', { name: 'Play', exact: true }).click();
		await expect(editor.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
		await expect.poll(() => page.evaluate(() => globalThis.__humRemovalNodes.created)).toBe(1);
		await panel.getByRole('group', { name: 'Hum removal', exact: true }).getByRole('button', { name: 'Select effect', exact: true }).click();
		const dialog = page.getByRole('dialog', { name: 'Hum removal', exact: true });
		await configure(dialog);
		await expect.poll(() => page.evaluate(() => globalThis.__humRemovalNodes.configured)).toBeGreaterThanOrEqual(4);
		expect(await page.evaluate(() => globalThis.__humRemovalNodes.created)).toBe(1);
		await expect(editor.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
		await closeDialog(dialog);
		await editor.getByRole('button', { name: 'Stop', exact: true }).click();
		await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved', { timeout: 10000 });
		await page.reload();
		editor = await waitForEditor(page);
		panel = await openEffectsForTrack(editor, 1);
		await panel.getByRole('group', { name: 'Hum removal', exact: true }).getByRole('button', { name: 'Select effect', exact: true }).click();
		for (const [name, value] of controls) {
			await expect(page.getByRole('dialog', { name: 'Hum removal', exact: true }).getByRole('spinbutton', { name, exact: true })).toHaveValue(value);
		}
		expect(errors).toEqual([]);
	});
});
