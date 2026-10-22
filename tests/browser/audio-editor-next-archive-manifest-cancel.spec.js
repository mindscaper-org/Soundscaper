/* SPDX-License-Identifier: AGPL-3.0-only */
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseExportProjectFileAction, chooseNestedCommandAction } from './audio-editor-test-helpers.js';
import { createSoundscaperProject } from '../../src/soundscaper/editor-project.ts';
import { exportScapeProject } from '../../src/common/editor/scape-project.js';
import { createProjectStore } from '../../src/common/editor/storage.js';
import { rewriteScapeProjectDocument } from '../helpers/scape-archive-rewrite.js';

test('native checksum export cancellation preserves its report for a successful retry', async ({ page }) => {
	const store = createProjectStore({ indexedDB: null, preferOpfs: false });
	let future;
	try {
		const archive = await exportScapeProject(createSoundscaperProject({ id: 'manifest-owner', title: 'Future archive' }), store);
		future = await rewriteScapeProjectDocument(archive.blob, project => {
			project.schemaVersion = 2; project.opaqueValue = 'Retain';
		});
	} finally { await store.close(); }
	await page.addInitScript(() => {
		let size = 0, purpose = '';
		globalThis.__manifestRequests = [];
		globalThis.__manifestReportWrites = 0;
		globalThis.__manifestCancelReport = true;
		Object.defineProperty(window, 'soundscaperDesktop', { value: { v1: {
			chooseSaveTarget: async request => {
				globalThis.__manifestRequests.push(request); purpose = request.purpose;
				return purpose === 'report' && globalThis.__manifestCancelReport ? null : { id: 'target', name: request.suggestedName };
			},
			beginWrite: async () => {
				if (purpose === 'report') globalThis.__manifestReportWrites += 1;
				size = 0; return { writeId: 'write', chunkSize: 1024 * 1024 };
			},
			writeChunk: async ({ offset, bytes }) => { size = offset + bytes.length; return { nextOffset: size }; },
			finishWrite: async () => ({ byteLength: size }), abortWrite: async () => true,
		} } });
	});
	const editor = await bootEditor(page, '/embed/en/');
	await editor.locator('[data-aup4-input]').setInputFiles({ name: 'future.sscape', mimeType: 'application/vnd.soundscaper.scape+zip', buffer: Buffer.from(await future.arrayBuffer()) });
	await expect(editor).toHaveAttribute('data-project-id', 'manifest-owner');
	// An exact retained-archive copy has readable bytes even on the native
	// streaming save route, so its checksums remain available for later work.
	await chooseExportProjectFileAction(page, editor);
	await expect(editor.locator('[data-status]')).toContainText('All changes saved locally');
	await editor.getByRole('button', { name: 'New project', exact: true }).click();
	await expect(editor).not.toHaveAttribute('data-project-id', 'manifest-owner');
	await chooseNestedCommandAction(page, editor, 'File', ['Project management', 'Save archive checksums']);
	await expect.poll(() => page.evaluate(() => globalThis.__manifestRequests.filter(request => request.purpose === 'report').length)).toBe(1);
	await expect(editor.locator('[data-status]')).not.toContainText('Archive checksums saved');
	expect(await page.evaluate(() => globalThis.__manifestReportWrites)).toBe(0);
	await page.evaluate(() => { globalThis.__manifestCancelReport = false; });
	await chooseNestedCommandAction(page, editor, 'File', ['Project management', 'Save archive checksums']);
	await expect(editor.locator('[data-status]')).toContainText('Archive checksums saved');
	expect(await page.evaluate(() => globalThis.__manifestReportWrites)).toBe(1);
});
