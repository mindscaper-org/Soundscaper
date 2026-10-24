/* SPDX-License-Identifier: AGPL-3.0-only */
import { expect, test, toneA } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseFileAction } from './audio-editor-test-helpers.js';
import { installNativeOriginalBridge } from './helpers/native-original-import-bridge.js';
import { nativeOriginalImportFixture } from '../helpers/native-original-import-fixture.ts';
import { encodeWav } from '../../src/common/editor/wav.js';
import { encodeAiff } from '../../src/common/editor/aiff.js';
import { inspectWavBlobPcm } from '../../src/common/editor/wav-import.js';
import { inspectAiffBlobPcm } from '../../src/common/editor/aiff-pcm-chunk-reader.ts';

for (const format of ['wav', 'aiff']) test(`Cancel releases a pending native ${format} PCM read before a fresh File Import`, async ({ page }) => {
	const channels = [new Float32Array(4800).fill(.2)];
	const bytes = format === 'wav' ? encodeWav(channels, { sampleRate: 48_000 }) : encodeAiff(channels, { sampleRate: 48_000 });
	const file = new File([bytes], `Pending.${format}`);
	const descriptor = format === 'wav' ? await inspectWavBlobPcm(file) : await inspectAiffBlobPcm(file);
	const native = await nativeOriginalImportFixture(file); let held = false; let released = false; let resume;
	const pending = new Promise(resolve => { resume = resolve; });
	try {
		await installNativeOriginalBridge(page, native, async (url, init) => {
			const response = await native.fetch(url, init);
			const range = /^bytes=(\d+)-(\d+)$/u.exec(new Headers(init.headers).get('Range'));
			if (!held && Number(range[1]) === descriptor.dataOffset && Number(range[2]) >= descriptor.dataOffset + 255) {
				held = true; await pending;
			}
			return response;
		});
		const editor = await bootEditor(page, '/embed/en/'); await chooseFileAction(page, editor, 'Import');
		await expect.poll(() => held).toBe(true);
		const progress = editor.locator('[data-editor-task-progress="import"]');
		await progress.getByRole('button', { name: 'Cancel', exact: true }).click();
		await expect(progress).toHaveCount(0); expect(released).toBe(false);
		await expect(editor).not.toHaveAttribute('data-edit-block-reason', 'importing');
		await editor.locator('[data-import-input]').setInputFiles({ ...toneA, name: 'Fresh.wav' });
		await expect(editor).toHaveAttribute('data-clip-count', '1', { timeout: 30_000 });
		await expect(editor.getByRole('group', { name: /^Fresh\.wav clip,/u })).toHaveCount(1);
		released = true; resume(); await page.evaluate(() => new Promise(requestAnimationFrame));
		await expect(editor).toHaveAttribute('data-clip-count', '1');
		await expect(editor.getByRole('group', { name: /^Fresh\.wav clip,/u })).toHaveCount(1);
		await expect(editor.getByRole('group', { name: /^Pending\.(wav|aiff) clip,/u })).toHaveCount(0);
		await expect(editor.locator('[data-editor-toast="workspace-status-error"]')).toHaveCount(0);
	} finally { resume(); await native.close(); }
});
