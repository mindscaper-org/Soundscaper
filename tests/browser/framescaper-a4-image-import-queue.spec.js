/* SPDX-License-Identifier: AGPL-3.0-only */
import { strFromU8, unzipSync } from 'fflate';
import { openFramescaperImageFramePackV1 } from '../../src/common/editor/timeline-image-frame-pack-v1.ts';
import { createPngFixture } from '../helpers/png-fixture.mjs';
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseNestedCommandAction, chooseExportProjectFileAction, collectClientErrors,
	disableNativeSavePicker, downloadBytes, waitForProjectActivation } from './audio-editor-test-helpers.js';

async function savedImage(page, editor, original, projectId) {
	await expect(editor).not.toHaveAttribute('data-edit-block-reason', /.+/u);
	const saving = page.waitForEvent('download'); await chooseExportProjectFileAction(page, editor);
	const download = await saving; expect(download.suggestedFilename()).toMatch(/\.fscape$/u);
	const entries = unzipSync(await downloadBytes(download)), project = JSON.parse(strFromU8(entries['project.json']));
	expect(project.id).toBe(projectId);
	const sources = project.sources.filter(source => source.kind === 'image'); expect(sources).toHaveLength(1);
	expect(sources[0].original.fileName).toBe('incoming.png');
	const manifest = JSON.parse(strFromU8(entries['manifest.json']));
	const asset = manifest.assets.find(asset => asset.sourceId === `framescaper:image:${sources[0].id}`);
	expect(asset).toBeTruthy(); const body = entries[asset.entry];
	const reader = await openFramescaperImageFramePackV1({ source: sources[0], read: (offset, length) => body.slice(offset, offset + length) });
	expect(Buffer.from(await reader.readOriginal()).equals(original)).toBe(true);
	const pixels = await reader.readFrame(0); expect(pixels).toHaveLength(16 * 16 * 4);
	for (let offset = 0; offset < pixels.length; offset += 4) expect([...pixels.subarray(offset, offset + 4)]).toEqual([33, 99, 181, 255]);
}

for (const variant of [{ late: 'success', returning: false }, { late: 'failure', returning: false },
	{ late: 'success', returning: true }, { late: null, returning: false }]) {
	test(`Add Images uses the current project queue: late=${variant.late} return=${variant.returning}`, async ({ page }) => {
		test.setTimeout(60_000); const errors = collectClientErrors(page);
		await page.addInitScript(held => {
			const read = File.prototype.arrayBuffer; globalThis.__imageReadHeld = false; globalThis.__imageReadSettled = false;
			globalThis.__releaseOldImage = () => undefined;
			File.prototype.arrayBuffer = function () {
				if (!held || this.name !== 'outgoing.png') return read.call(this);
				globalThis.__imageReadHeld = true;
				return new Promise((resolve, reject) => {
					globalThis.__releaseOldImage = failure => {
						globalThis.__releaseOldImage = () => undefined;
						if (failure) { globalThis.__imageReadSettled = true; reject(new Error('Late old image read failed.')); }
						else void read.call(this).then(bytes => { globalThis.__imageReadSettled = true; resolve(bytes); }, reject);
					};
				});
			};
		}, variant.late !== null);
		await disableNativeSavePicker(page); const editor = await bootEditor(page, '/framescaper/embed/en/');
		// A native canvas PNG is an ordinary opaque, exact-colour input.
		const png = Buffer.from(await page.evaluate(async () => {
			const canvas = document.createElement('canvas'); canvas.width = 16; canvas.height = 16;
			const context = canvas.getContext('2d'); context.fillStyle = '#2163b5'; context.fillRect(0, 0, 16, 16);
			const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
			return [...new Uint8Array(await blob.arrayBuffer())];
		}));
		const outgoingId = await editor.getAttribute('data-project-id');
		const selecting = page.waitForEvent('filechooser'); await chooseNestedCommandAction(page, editor, 'Generate', ['Add Images']);
		await (await selecting).setFiles({ name: 'outgoing.png', mimeType: 'image/png', buffer: createPngFixture(16) });
		if (variant.late) await expect.poll(() => page.evaluate(() => globalThis.__imageReadHeld)).toBe(true);
		else await expect(editor.getByRole('group', { name: 'Image clip: outgoing', exact: true })).toBeVisible();
		await editor.getByRole('button', { name: 'New project', exact: true }).click();
		await expect(editor).not.toHaveAttribute('data-project-id', outgoingId);
		await waitForProjectActivation(editor);
		if (variant.returning) {
			const tabs = editor.getByRole('navigation', { name: 'Project tabs' }).getByRole('tab');
			await expect(tabs).toHaveCount(2); await tabs.first().click(); await expect(editor).toHaveAttribute('data-project-id', outgoingId);
			await waitForProjectActivation(editor);
		}
		const projectId = await editor.getAttribute('data-project-id');
		try {
			const choosing = page.waitForEvent('filechooser', { timeout: 5000 }); await chooseNestedCommandAction(page, editor, 'Generate', ['Add Images']);
			await (await choosing).setFiles({ name: 'incoming.png', mimeType: 'image/png', buffer: png });
			await expect(editor.getByRole('group', { name: 'Image clip: incoming', exact: true })).toBeVisible();
			await expect(editor.getByRole('group', { name: /^Image clip:/u })).toHaveCount(1);
			if (variant.late) expect(await page.evaluate(() => globalThis.__imageReadSettled)).toBe(false);
			await savedImage(page, editor, png, projectId);
			const status = await editor.locator('[data-status]').first().textContent();
			if (variant.late) {
				await page.evaluate(failure => globalThis.__releaseOldImage(failure), variant.late === 'failure');
				await expect.poll(() => page.evaluate(() => globalThis.__imageReadSettled)).toBe(true);
				await expect(editor.locator('[data-status]').first()).toHaveText(status);
				const following = page.waitForEvent('filechooser'); await chooseNestedCommandAction(page, editor, 'Generate', ['Add Images']);
				await (await following).setFiles({ name: 'after.png', mimeType: 'image/png', buffer: png });
				await expect(editor.getByRole('group', { name: 'Image clip: after', exact: true })).toBeVisible();
				await expect(editor.getByRole('group', { name: /^Image clip:/u })).toHaveCount(2);
				await chooseCommandAction(page, editor, 'Edit', 'Undo');
				await expect(editor.getByRole('group', { name: 'Image clip: incoming', exact: true })).toBeVisible();
				await expect(editor.getByRole('group', { name: /^Image clip:/u })).toHaveCount(1);
			}
			expect(errors).toEqual([]);
		} finally { if (!page.isClosed()) await page.evaluate(() => globalThis.__releaseOldImage(false)); }
	});
}
