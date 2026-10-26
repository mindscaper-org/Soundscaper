/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, toneA } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, importFiles } from './audio-editor-test-helpers.js';
import { createSoundscaperProject } from '../../src/soundscaper/editor-project.ts';
import { createSoundscaperScapeNativeRuntime } from '../../src/soundscaper/editor-scape-native.ts';

for (const saveReport of [false, true]) test(saveReport ? 'a failed old Contrast report save stays with the project that requested it' : 'File Open clears the outgoing Contrast report before activating another project', async ({ page }) => {
	const archive = await createSoundscaperScapeNativeRuntime().exportScapeProject(
		createSoundscaperProject({ id: 'next-report-owner', title: 'Incoming report project' }), {
			async getMediaAssetMetadata() { return null; }, async loadMediaAsset() { return null; },
			readSourceChunks() { return (async function* empty() {})(); },
		});
	await page.addInitScript(base64 => {
		const bytes = Uint8Array.from(atob(base64), character => character.charCodeAt(0));
		const descriptor = { id: 'e'.repeat(40), readProfile: 'scape-range-v1', name: 'Incoming.sscape',
			mimeType: 'application/vnd.soundscaper.scape+zip', size: bytes.length,
			url: `soundscaper-app://bundle/_desktop/read/scape-range-v1/${'e'.repeat(40)}/Incoming.sscape` };
		const originalFetch = globalThis.fetch;
		globalThis.fetch = function (input, init) {
			if (String(input) !== descriptor.url) return originalFetch.call(this, input, init);
			const range = /^bytes=(\d+)-(\d+)$/u.exec(new Headers(init.headers).get('Range'));
			if (!range) throw new Error('An archive read needs an exact byte range.');
			const start = Number(range[1]), end = Number(range[2]), body = bytes.slice(start, end + 1);
			return Promise.resolve(new Response(body, { status: 206, headers: {
				'Content-Type': descriptor.mimeType, 'Content-Length': String(body.length),
				'Content-Range': `bytes ${start}-${end}/${bytes.length}`,
			} }));
		};
		Object.defineProperty(globalThis, 'soundscaperDesktop', { configurable: true, value: { v1: {
			onOpenProject(listener) { globalThis.__nextReportOpen = () => listener(descriptor); return () => {}; },
			async releaseRead() {},
			chooseSaveTarget(request) {
				if (request.purpose !== 'report') throw new Error('Only the actual report save is expected.');
				return new Promise((_resolve, reject) => {
					globalThis.__nextReportRejectSave = () => reject(new Error('Old report destination is unavailable.'));
				});
			},
		} } });
	}, Buffer.from(await archive.blob.arrayBuffer()).toString('base64'));
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [toneA]);
	await chooseCommandAction(page, editor, 'Select', 'Select all');
	await chooseCommandAction(page, editor, 'Analyze', 'Contrast');
	const dialog = page.getByRole('dialog', { name: 'Contrast', exact: true });
	await dialog.getByRole('button', { name: 'Measure foreground', exact: true }).click();
	await expect(dialog.locator('[data-analysis-report="contrast"]')).toBeVisible();
	if (saveReport) {
		await dialog.getByRole('button', { name: 'Export', exact: true }).click();
		await expect.poll(() => page.evaluate(() => typeof globalThis.__nextReportRejectSave)).toBe('function');
	}
	await page.evaluate(() => globalThis.__nextReportOpen());
	await expect(editor).toHaveAttribute('data-project-id', 'next-report-owner');
	if (!saveReport) {
		await expect(dialog.locator('[data-analysis-report="contrast"]')).toHaveCount(0);
		return;
	}
	await page.evaluate(() => {
		globalThis.__nextReportRejectSave();
		return new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
	});
	await expect(dialog.getByRole('alert')).toHaveCount(0);
});
