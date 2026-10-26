/* SPDX-License-Identifier: AGPL-3.0-only */
import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, waitForEditor, openClipProperties, closeClipProperties } from './audio-editor-test-helpers.js';
import { readClipGain, setClipGain } from './audio-editor-clip-settings-test-helpers.js';
import { clearSourceProvenance, installLinkedAudioBridge } from './helpers/linked-audio-relink-fixture.js';

test('a completed old-source normalization cannot change an accepted linked replacement', async ({ page }) => {
	await installLinkedAudioBridge(page, {
		original: createWavFixture({ name: 'Original.wav', frequency: 330, duration: 1, channelCount: 1, channelAmplitudes: [.2] }),
		changed: createWavFixture({ name: 'Changed.wav', frequency: 660, duration: 1, channelCount: 1, channelAmplitudes: [.7] }),
	});
	await page.addInitScript(() => {
		const NativeWorker = globalThis.Worker;
		const state = { held: false, hold: true, release: null };
		globalThis.__normalizationOwner = state;
		globalThis.Worker = class extends NativeWorker {
			constructor(url, options) { super(url, options); this.normalizationAnalysis = /\/analysis-worker-/u.test(String(url)); }
			set onmessage(listener) {
				this.listener = listener;
				super.onmessage = listener === null ? null : event => {
					if (this.normalizationAnalysis && state.hold && event.data.type === 'result') {
						state.held = true;
						state.release = () => { state.hold = false; listener.call(this, event); };
					} else listener.call(this, event);
				};
			}
			get onmessage() { return this.listener ?? null; }
		};
	});
	const editor = await bootEditor(page, '/embed/en/');
	await editor.getByRole('button', { name: 'Link WAV', exact: true }).click();
	const card = editor.locator('[data-project-bin-item]').first(); await expect(card).toBeVisible();
	await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');
	await clearSourceProvenance(page, await editor.getAttribute('data-project-id'));
	await page.reload(); await waitForEditor(page);
	await card.getByRole('button', { name: /Add to timeline/u }).click();
	await expect(editor).toHaveAttribute('data-clip-count', '1');
	const clip = editor.locator('[data-clip-id]').first();
	let properties = await openClipProperties(page, editor, clip, { additional: false });
	await setClipGain(properties, -20); await closeClipProperties(properties);
	await clip.click({ button: 'right' });
	await page.getByRole('menuitem', { name: 'Normalize to −1 dBFS', exact: true }).click();
	await expect.poll(() => page.evaluate(() => globalThis.__normalizationOwner.held)).toBe(true);
	await page.evaluate(() => { globalThis.__projectBinLinkedAudioFixture.next = 'accepted'; });
	await card.getByRole('button', { name: /More file actions/u }).click();
	await page.getByRole('menuitem', { name: 'Relink', exact: true }).click();
	const changed = page.locator('[data-project-bin-relink-changed-dialog]'); await expect(changed).toBeVisible();
	await changed.getByRole('button', { name: 'Replace', exact: true }).click(); await expect(changed).toBeHidden();
	await expect.poll(() => page.evaluate(() => globalThis.__projectBinLinkedAudioFixture.rangeRequests.some(read => read.kind === 'changed'))).toBe(true);
	await page.evaluate(() => { globalThis.__normalizationOwner.release(); });
	properties = await openClipProperties(page, editor, clip, { additional: false });
	await expect.poll(() => readClipGain(properties)).toBe(-20);
	await closeClipProperties(properties);
	await clip.click({ button: 'right' });
	await page.getByRole('menuitem', { name: 'Normalize to −1 dBFS', exact: true }).click();
	properties = await openClipProperties(page, editor, clip, { additional: false });
	await expect.poll(() => readClipGain(properties)).toBeGreaterThan(1);
	await expect.poll(() => readClipGain(properties)).toBeLessThan(3);
});
