/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseDropdown, chooseFileAction, openExportDialog, waitForProjectActivation } from './audio-editor-test-helpers.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { createFramescaperProject } from '../../src/framescaper/editor-project.ts';
import { createFramescaperProjectStore } from '../../src/framescaper/editor-project-store.ts';
import { createFramescaperScapeNativeRuntime } from '../../src/framescaper/editor-scape-native.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE as PROFILE } from '../../src/framescaper/editor-project-runtime-profile.ts';

for (const [fit, label] of [['cover', 'Fill and crop'], ['stretch', 'Stretch to fill']]) {
	test(`a frozen portrait PNG keeps its stripe under ${fit} delivery`, async ({ page }) => {
		await page.addInitScript(() => {
			globalThis.__detailPeaks = [];
			const put = CanvasRenderingContext2D.prototype.putImageData;
			CanvasRenderingContext2D.prototype.putImageData = function (...args) {
				const result = Reflect.apply(put, this, args), frame = args[0];
				if (frame.width === 12 && frame.height === 4) {
					let peak = 0; for (let i = 0; i < frame.data.length; i += 4) peak = Math.max(peak, frame.data[i]);
					globalThis.__detailPeaks.push(peak);
				}
				return result;
			};
		});
		const editor = await bootEditor(page, '/framescaper/embed/en/');
		const png = Buffer.from(await page.evaluate(() => {
			const canvas = document.createElement('canvas'); canvas.width = 4; canvas.height = 12;
			const c = canvas.getContext('2d'); c.fillStyle = 'black'; c.fillRect(0, 0, 4, 12);
			c.fillStyle = 'white'; c.fillRect(2, 0, 1, 12); return canvas.toDataURL('image/png').split(',')[1];
		}), 'base64');
		const storageKey = `png-${fit}`;
		const project = createFramescaperProject(PROFILE, { id: `frozen-detail-${fit}`, primarySequenceId: 'main',
			visualModel: { stillSources: [{ schemaVersion: 1, kind: 'still', id: storageKey, name: 'Frozen portrait', mimeType: 'image/png',
				storageKey, contentSha256: bytesToHex(sha256(png)), width: 4, height: 12, hasAlpha: false }] },
			clips: [{ schemaVersion: 1, kind: 'still', id: 'still', sourceId: storageKey, sequenceId: 'main', sequenceStartFrame: 0, sequenceFrameCount: 30 }],
			tracks: [{ id: 'pictures', type: 'video', clipIds: ['still'] }],
			sequences: [{ id: 'main', rate: { num: 30, den: 1 }, trackIds: ['pictures'] }],
		});
		const store = createFramescaperProjectStore(PROFILE, { indexedDB: null, preferOpfs: false });
		await store.writeMediaAsset(storageKey, new Blob([png], { type: 'image/png' }), { name: 'Frozen portrait', mimeType: 'image/png' });
		const archive = await createFramescaperScapeNativeRuntime(PROFILE).exportScapeProject(project, store);
		const choosing = page.waitForEvent('filechooser'); await chooseFileAction(page, editor, 'Open');
		await (await choosing).setFiles({ name: 'Frozen portrait.fscape', mimeType: 'application/zip', buffer: Buffer.from(await archive.blob.arrayBuffer()) });
		await expect(editor).toHaveAttribute('data-project-id', project.id); await waitForProjectActivation(editor);
		const dialog = await openExportDialog(page, editor, { label: 'Export video' });
		await chooseDropdown(page, dialog.getByRole('group', { name: 'Format', exact: true }), 'WebM video');
		await dialog.getByRole('spinbutton', { name: 'Width', exact: true }).fill('12');
		await dialog.getByRole('spinbutton', { name: 'Height', exact: true }).fill('4');
		await chooseDropdown(page, dialog.getByRole('group', { name: 'Fit', exact: true }), label);
		await expect.poll(() => page.evaluate(() => globalThis.__detailPeaks.at(-1) ?? 0)).toBeGreaterThan(240);
	});
}
