/* SPDX-License-Identifier: AGPL-3.0-only */
import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, waitForEditor, getMenuItem, openExportDialog, chooseDropdown, closeDialog } from './audio-editor-test-helpers.js';
import { createSoundscaperProject } from '../../src/soundscaper/editor-project.ts';
import { createAudioTrack } from '../../src/common/editor/project-media-factory.ts';
import { createEffect } from '../../src/common/editor/effects.js';
import { createProjectStore } from '../../src/common/editor/storage.js';
import { exportScapeProject } from '../../src/common/editor/scape-project.js';
import { SOUNDSCAPER_DATABASE_NAME } from './helpers/editor-databases.js';
import { clearSourceProvenance, installLinkedAudioBridge } from './helpers/linked-audio-relink-fixture.js';

test('Relink protects authenticated frozen audio while exact relocation stays available', async ({ page }) => {
	test.setTimeout(90_000);
	await installLinkedAudioBridge(page, {
		original: createWavFixture({ name: 'Original.wav', frequency: 330, duration: .5, channelCount: 1, channelAmplitudes: [.2] }),
		changed: createWavFixture({ name: 'Changed.wav', frequency: 660, duration: .5, channelCount: 1, channelAmplitudes: [.2] }),
	});
	const editor = await bootEditor(page, '/embed/en/');
	const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: crypto.randomUUID() });
	try {
		const archive = await exportScapeProject(createSoundscaperProject({ id: 'frozen-linked', title: 'Frozen linked', tracks: [createAudioTrack({ id: 'voice', name: 'Voice', effects: [createEffect('lowpass', { id: 'filter', params: { frequency: 20_000, q: .707 } })] })] }), store);
		expect(archive.blob).toBeInstanceOf(Blob);
		await editor.locator('[data-aup4-input]').setInputFiles({ name: 'Frozen.sscape', mimeType: 'application/zip', buffer: Buffer.from(await archive.blob.arrayBuffer()) });
		await expect(editor).toHaveAttribute('data-project-id', 'frozen-linked');
	} finally { await store.close(); }
	await editor.getByRole('button', { name: 'Link WAV', exact: true }).click();
	const card = editor.locator('[data-project-bin-item]').first(); await expect(card).toBeVisible();
	await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');
	await clearSourceProvenance(page, await editor.getAttribute('data-project-id'));
	await page.reload(); await waitForEditor(page);
	await editor.locator('[data-track-id="voice"] [data-track-header]').click();
	await card.getByRole('button', { name: /Add to timeline/u }).click();
	await expect(editor).toHaveAttribute('data-clip-count', '1');
	const tracks = await openMenu(page, editor, 'Tracks');
	const freeze = getMenuItem(tracks, 'Freeze'); await expect(freeze).toBeVisible({ timeout: 3000 }); await freeze.focus(); await page.keyboard.press('ArrowRight');
	await getMenuItem(freeze.getByRole('menu'), 'Freeze track').click();
	await expect.poll(async () => {
		const menu = await openMenu(page, editor, 'Tracks');
		const ready = await getMenuItem(menu, 'Freeze (fresh)').count(); await page.keyboard.press('Escape'); return ready;
	}).toBe(1);
	await expectExportedTone(page, editor, 330);
	await page.evaluate(() => { globalThis.__projectBinLinkedAudioFixture.next = 'exact'; });
	await card.getByRole('button', { name: /More file actions/u }).click();
	await page.getByRole('menuitem', { name: 'Relink', exact: true }).click();
	await expect.poll(async () => (await bindings(page)).map(binding => binding.locatorId)).toEqual(['2'.repeat(64)]);
	const relocated = await bindings(page);
	await expectExportedTone(page, editor, 330);
	await page.evaluate(() => { globalThis.__projectBinLinkedAudioFixture.next = 'accepted'; });
	await card.getByRole('button', { name: /More file actions/u }).click();
	await page.getByRole('menuitem', { name: 'Relink', exact: true }).click();
	await expect(editor.getByRole('alert')).toContainText('Import the selected file as new media');
	await expect(page.locator('[data-project-bin-relink-changed-dialog]')).toBeHidden();
	expect(await bindings(page)).toEqual(relocated);
	await expectExportedTone(page, editor, 330);
});

async function expectExportedTone(page, editor, frequency) {
	const count = await page.evaluate(() => globalThis.__projectBinLinkedAudioFixture.exports.length);
	const dialog = await openExportDialog(page, editor);
	await chooseDropdown(page, dialog.locator('[data-export-field="format"]'), 'WAV');
	await dialog.getByRole('button', { name: 'Export', exact: true }).click();
	await expect.poll(() => page.evaluate(() => globalThis.__projectBinLinkedAudioFixture.exports.length)).toBe(count + 1);
	await closeDialog(dialog);
	const actual = await page.evaluate(async () => {
		const bytes = globalThis.__projectBinLinkedAudioFixture.exports.at(-1);
		const context = new AudioContext();
		try {
			const audio = await context.decodeAudioData(bytes.buffer.slice(0));
			const pcm = audio.getChannelData(0), start = Math.floor(pcm.length / 4), end = Math.floor(pcm.length * 3 / 4);
			let crossings = 0;
			for (let frame = start + 1; frame < end; frame++) if (pcm[frame - 1] < 0 && pcm[frame] >= 0) crossings++;
			return crossings * audio.sampleRate / (end - start);
		} finally { await context.close(); }
	});
	expect(Math.abs(actual - frequency)).toBeLessThan(8);
}

async function openMenu(page, editor, label) {
	await editor.getByRole('menuitem', { name: label, exact: true }).click();
	return page.getByRole('menu', { name: label, exact: true });
}

async function bindings(page) {
	return page.evaluate(databaseName => new Promise((resolve, reject) => {
		const opening = indexedDB.open(databaseName);
		opening.onerror = () => reject(opening.error);
		opening.onsuccess = () => {
			const database = opening.result;
			const request = database.transaction('linkedVideoOriginalBindings', 'readonly').objectStore('linkedVideoOriginalBindings').getAll();
			request.onerror = () => { database.close(); reject(request.error); };
			request.onsuccess = () => { database.close(); resolve(request.result.map(record => record.binding).filter(binding => binding.projectId === 'frozen-linked')); };
		};
	}), SOUNDSCAPER_DATABASE_NAME);
}
