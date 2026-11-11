/* SPDX-License-Identifier: AGPL-3.0-only */
import { strFromU8, unzipSync } from 'fflate';
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseExportProjectFileAction, disableNativeSavePicker, downloadBytes, sourcePeakChannels, waitForProjectActivation } from './audio-editor-test-helpers.js';
import { ordinaryOggFlacFixture } from '../helpers/ogg-multiplexed-tail-fixture.ts';

test('native Ogg-FLAC generic/plain admission and programme metadata retain PCM through Save', async ({ page }) => {
	const caseTimeout = test.info().timeout;
	test.setTimeout(caseTimeout * 3);
	await disableNativeSavePicker(page); const editor = await bootEditor(page, '/embed/en/');
	let first = true;
	const nextProject = async () => {
		if (first) { first = false; return; }
		const previousId = await editor.getAttribute('data-project-id');
		await editor.getByRole('button', { name: 'New project', exact: true }).click();
		await expect(editor).not.toHaveAttribute('data-project-id', previousId);
		await waitForProjectActivation(editor);
		await expect(editor).toHaveAttribute('data-clip-count', '0');
	};
	for (const generic of [true, false]) await test.step(`generic name=${generic}`, async () => {
		await nextProject();
		const file = await ordinaryOggFlacFixture();
		const expected = await page.evaluate(async bytes => {
			const context = new OfflineAudioContext(1, 1, 48_000); const decoded = await context.decodeAudioData(Uint8Array.from(bytes).buffer);
			return [...decoded.getChannelData(0)];
		}, [...new Uint8Array(await file.arrayBuffer())]);
		expect(expected).toHaveLength(1024); expect(Math.max(...expected)).toBeGreaterThan(.29);
		await editor.locator('[data-import-input]').setInputFiles({ name: generic ? 'Recorder.bin' : file.name,
			mimeType: generic ? '' : file.type, buffer: Buffer.from(await file.arrayBuffer()) });
		await expect(editor).toHaveAttribute('data-clip-count', '1', { timeout: 30_000 });
		const downloading = page.waitForEvent('download'); await chooseExportProjectFileAction(page, editor);
		const entries = unzipSync(await downloadBytes(await downloading)); const document = JSON.parse(strFromU8(entries['project.json']));
		expect(document.sources[0]).toMatchObject({ sampleRate: 48_000, channelCount: 1, frameCount: 1024 });
		const [, payload] = Object.entries(entries).find(([name]) => name.endsWith('.f32c')); const bytes = Buffer.from(payload);
		expect(Array.from({ length: 1024 }, (_, frame) => bytes.readFloatLE(4 + frame * 4))).toEqual(expected);
	}, { timeout: caseTimeout });
	await test.step('programme credits and artwork', async () => {
		await nextProject();
		const file = await ordinaryOggFlacFixture({ title: 'Field recording', artist: 'Ada — reviewed credit', licence: 'CC BY 4.0',
			id3Artwork: JSON.stringify([{ mimeType: 'image/png', pictureType: 3, description: 'Original cover',
				data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j7mQAAAAASUVORK5CYII=' }]) });
		await editor.locator('[data-import-input]').setInputFiles({ name: file.name, mimeType: file.type, buffer: Buffer.from(await file.arrayBuffer()) });
		await expect(editor).toHaveAttribute('data-clip-count', '1', { timeout: 30_000 });
		await expect.poll(async () => (await sourcePeakChannels(page, file.name)).channelCount).toBe(1);
		const peak = await sourcePeakChannels(page, file.name); expect(peak.channels[0].maximum).toBeGreaterThan(.29);
		await expect(editor).not.toHaveAttribute('data-edit-block-reason', 'importing', { timeout: 30_000 });
		const downloading = page.waitForEvent('download'); await chooseExportProjectFileAction(page, editor);
		const document = JSON.parse(strFromU8(unzipSync(await downloadBytes(await downloading))['project.json']));
		const source = document.sources.find(source => source.name === file.name); expect(source).toMatchObject({ sampleRate: 48_000, channelCount: 1, frameCount: 1024 });
		const contribution = source.provenance.contributions[0]; expect(contribution.warnings).toEqual([]);
		expect(contribution.metadata.normalized).toMatchObject({ title: 'Field recording', artist: 'Ada — reviewed credit' });
		expect(contribution.metadata.raw.LICENCE).toBe('CC BY 4.0');
		expect(contribution.attachments).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'coverFront', description: 'Original cover', byteLength: 68 })]));
	}, { timeout: caseTimeout });
});
