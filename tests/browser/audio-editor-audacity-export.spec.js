/* SPDX-License-Identifier: AGPL-3.0-only */

import { writeFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';

import {
	expect,
	monoTone,
	test,
} from './audio-editor-test-fixtures.js';
import {
	bootEditor,
	chooseFileAction,
	chooseNestedCommandAction,
	clipByName,
	collectClientErrors,
	disableNativeSavePicker,
	downloadBytes,
	importFiles,
	trackNameText,
} from './audio-editor-test-helpers.js';

for (const { generation, userVersion } of [
	{ generation: 'aup3', userVersion: 0x03070000 },
	{ generation: 'aup4', userVersion: 0x04000001 },
]) {
	test(`exports an ${generation.toUpperCase()} through the File menu and reopens its audio`, async ({ page }, testInfo) => {
		test.setTimeout(90_000);
		await disableNativeSavePicker(page);
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [monoTone]);
		await expect(clipByName(editor, monoTone.name)).toHaveCount(1);

		const originalTrackCount = await editor.getAttribute('data-track-count');
		const originalClipCount = await editor.getAttribute('data-clip-count');
		const originalTrackNames = await trackNameText(editor).allTextContents();
		const downloadPromise = page.waitForEvent('download');
		await chooseNestedCommandAction(page, editor, 'File', ['Export other', `Export ${generation.toUpperCase()}`]);
		const download = await downloadPromise;
		expect(download.suggestedFilename().endsWith(`.${generation}`)).toBe(true);
		const bytes = await downloadBytes(download);
		expect(new TextDecoder().decode(bytes.subarray(0, 16))).toBe('SQLite format 3\0');
		expect(new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(60)).toBe(userVersion);
		const nativePath = testInfo.outputPath(`Audacity project (export).${generation}`);
		await writeFile(nativePath, bytes);
		const reader = new DatabaseSync(nativePath, { readOnly: true });
		let primary;
		let checkpoint;
		try {
			// A pre-existing reader must not block Audacity's native journal setup.
			reader.exec('BEGIN');
			expect(reader.prepare('SELECT count(*) AS count FROM project').get().count).toBe(1);
			// Audacity 3 and 4 configure both connections this way in DBConnection::OpenStepByStep.
			primary = new DatabaseSync(nativePath);
			expect(primary.prepare("SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'project') AS present").get().present).toBe(1);
			const safeConfig = 'PRAGMA busy_timeout = 5000; PRAGMA locking_mode = SHARED;'
				+ 'PRAGMA synchronous = NORMAL; PRAGMA journal_mode = WAL; PRAGMA wal_autocheckpoint = 0;';
			primary.exec(safeConfig);
			checkpoint = new DatabaseSync(nativePath);
			checkpoint.exec(safeConfig);
			expect(primary.prepare('PRAGMA journal_mode').get().journal_mode).toBe('wal');
			expect(checkpoint.prepare('SELECT count(*) AS count FROM project').get().count).toBe(1);
		} finally {
			checkpoint?.close();
			primary?.close();
			reader.close();
		}

		expect([...bytes.subarray(18, 20)]).toEqual([2, 2]);

		const chooser = page.waitForEvent('filechooser');
		await chooseFileAction(page, editor, 'Open');
		await (await chooser).setFiles({
			name: download.suggestedFilename(),
			mimeType: 'application/x-audacity-project',
			buffer: Buffer.from(bytes),
		});
		await expect(editor.locator('[data-status]')).toContainText('Audacity project opened', {
			timeout: 30_000,
		});
		await expect(editor).toHaveAttribute('data-track-count', originalTrackCount);
		await expect(editor).toHaveAttribute('data-clip-count', originalClipCount);
		await expect(trackNameText(editor)).toHaveText(originalTrackNames);
		await expect(clipByName(editor, monoTone.name.replace(/\.[^.]+$/u, ''))).toHaveCount(1);
		expect(errors).toEqual([]);
	});
}
