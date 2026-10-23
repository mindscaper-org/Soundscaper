/* SPDX-License-Identifier: AGPL-3.0-only */

import { createHash } from 'node:crypto';
import { strFromU8, unzipSync } from 'fflate';
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseExportProjectFileAction, disableNativeSavePicker, downloadBytes } from './audio-editor-test-helpers.js';
import { multilingualMp3Fixture } from '../helpers/ordinary-cover-mp3-fixture.ts';

test('File Import and native Save retain every bilingual ID3 comment, lyric and identifier', async ({ page }) => {
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/');
	const { file, payloads, records } = await multilingualMp3Fixture();
	await editor.locator('[data-import-input]').setInputFiles({ name: file.name, mimeType: file.type, buffer: Buffer.from(await file.arrayBuffer()) });
	await expect(editor).toHaveAttribute('data-clip-count', '1', { timeout: 30_000 });
	const downloading = page.waitForEvent('download');
	await chooseExportProjectFileAction(page, editor);
	const document = JSON.parse(strFromU8(unzipSync(await downloadBytes(await downloading))['project.json']));
	const contribution = document.sources[0].provenance.contributions[0];
	expect(contribution.warnings).toEqual([]);
	for (const [key, payload] of Object.entries(payloads)) {
		const pathKey = records[key] ? `${key}.bytes` : key;
		expect(contribution.metadata.raw[key]).toEqual(records[key] ?? { attachmentPath: `raw.${key}` });
		expect(contribution.attachments.find(({ path }) => path === `raw.${pathKey}`)).toMatchObject({
			sha256: createHash('sha256').update(payload).digest('hex'), byteLength: payload.length });
	}
	expect(contribution.metadata.normalized.lyrics).toBe('First verse');
});
