/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test, toneA, captionLabels, readFile } from './audio-editor-test-fixtures.js';
import {
	bootEditor, chooseDropdown, chooseFileAction, chooseNestedCommandAction,
	collectClientErrors, disableNativeSavePicker, importFiles, registerAudioEditorHooks,
	trackNameText, waitForEditor, waitForProjectActivation,
} from './audio-editor-test-helpers.js';
import { createDeterministicAvFixture } from './fixtures/deterministic-av-media.js';
import { readDawprojectArchive } from '../../src/common/editor/dawproject-archive.ts';

test.describe('label and interchange exporters', () => {
	registerAudioEditorHooks();
	test('TXT and WebVTT import through File > Import and each survive reload', async ({ page }) => {
		const caseTimeout = test.info().timeout;
		test.setTimeout(caseTimeout * 2);
		const errors = collectClientErrors(page);
		let editor = await bootEditor(page, '/embed/en/');
		let first = true;
		for (const fixture of [
			{
				name: 'audacity-labels.txt', mimeType: 'text/plain',
				text: '0.125\t0.750\tTXT intro\n1.000\t1.500\tTXT outro\n',
				titles: ['TXT intro', 'TXT outro'],
			},
			{
				name: 'browser-labels.vtt', mimeType: 'text/vtt',
				text: 'WEBVTT\n\nintro\n00:00:00.250 --> 00:00:01.500\nVTT intro\n\noutro\n00:00:02.000 --> 00:00:03.250\nVTT outro\n',
				titles: ['VTT intro', 'VTT outro'],
			},
		]) await test.step(fixture.name, async () => {
			if (!first) {
				const previousId = await editor.getAttribute('data-project-id');
				await editor.getByRole('button', { name: 'New project', exact: true }).click();
				await expect(editor).not.toHaveAttribute('data-project-id', previousId);
				await waitForProjectActivation(editor);
				await expect(editor.locator('[data-label-id]')).toHaveCount(0);
			}
			first = false;
			const choosingFile = page.waitForEvent('filechooser');
			await chooseFileAction(page, editor, 'Import');
			await (await choosingFile).setFiles({
				name: fixture.name, mimeType: fixture.mimeType, buffer: Buffer.from(fixture.text),
			});
			await expect(editor.locator('[data-status]')).toHaveText('Imported 2 label(s).');
			await expect(editor.locator('[data-label-track] [data-label-id]')).toHaveCount(2);
			await expect(editor.locator('[data-label-track] [data-label-id]')).toContainText(fixture.titles);
			await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');
			await page.reload();
			editor = await waitForEditor(page);
			await expect(editor.locator('[data-label-track] [data-label-id]')).toHaveCount(2);
			await expect(editor.locator('[data-label-track] [data-label-id]')).toContainText(fixture.titles);
			expect(errors).toEqual([]);
		}, { timeout: caseTimeout });
	});

	test('TXT, SRT, WebVTT and Podcast label exports retain cue text and timing', async ({ page }) => {
		const caseTimeout = test.info().timeout;
		test.setTimeout(caseTimeout * 4);
		const errors = collectClientErrors(page);
		await disableNativeSavePicker(page);
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [captionLabels]);
		for (const [label, extension] of [
			['As Audacity TXT', 'txt'], ['As SubRip (SRT)', 'srt'],
			['As WebVTT', 'vtt'], ['As Podcast 2.0 chapters (JSON)', 'json'],
		]) await test.step(label, async () => {
			await chooseNestedCommandAction(page, editor, 'File', ['Export other', 'Export labels']);
			const dialog = page.getByRole('dialog', { name: 'Export labels', exact: true });
			await chooseDropdown(page, dialog.getByRole('group', { name: 'Format', exact: true }), label);
			const downloadPromise = page.waitForEvent('download');
			await dialog.getByRole('button', { name: 'Export labels', exact: true }).click();
			const download = await downloadPromise;
			expect(download.suggestedFilename()).toMatch(new RegExp(`\\.${extension}$`));
			const text = (await readFile(await download.path(), 'utf8')).replace(/^\uFEFF/, '');
			if (extension === 'json') {
				const document = JSON.parse(text);
				expect(document).toEqual({
					version: '1.2.0',
					chapters: [
						{ startTime: 0.25, title: 'Intro caption' },
						{ startTime: 2, title: 'Outro caption' },
					],
				});
			} else if (extension === 'txt') {
				expect(text).toBe('0.25\t1.5\tIntro caption\n2\t3.25\tOutro caption\n');
			} else {
				const separator = extension === 'srt' ? ',' : '.';
				expect(text).toBe([
					...(extension === 'vtt' ? ['WEBVTT', ''] : []),
					'1',
					`00:00:00${separator}250 --> 00:00:01${separator}500`,
					'Intro caption',
					'',
					'2',
					`00:00:02${separator}000 --> 00:00:03${separator}250`,
					'Outro caption',
					'',
				].join('\n'));
			}
			await expect(dialog).toBeHidden();
			expect(errors).toEqual([]);
		}, { timeout: caseTimeout });
	});

	test('DAWproject exports embedded audio and reopens as an editable project', async ({ page }) => {
		await disableNativeSavePicker(page);
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/');
		await importFiles(editor, [toneA]);
		const trackName = await trackNameText(editor).first().textContent();
		const downloadPromise = page.waitForEvent('download');
		await chooseNestedCommandAction(page, editor, 'File', ['Export other', 'Export DAWproject']);
		const download = await downloadPromise;
		expect(download.suggestedFilename()).toMatch(/\.dawproject$/);
		const bytes = await readFile(await download.path());
		const archive = await readDawprojectArchive(new Blob([bytes]));
		try {
			expect(archive.projectXml).toContain('<Audio');
			const audioPath = archive.entryNames.find((name) => name.endsWith('.wav'));
			expect(audioPath).toBeTruthy();
			expect((await archive.readEntry(audioPath)).size).toBeGreaterThan(1000);
		} finally { await archive.close(); }
		const chooser = page.waitForEvent('filechooser');
		await chooseFileAction(page, editor, 'Open');
		await (await chooser).setFiles({ name: 'roundtrip.dawproject', mimeType: 'application/zip', buffer: bytes });
		await expect(editor.locator('[data-status]')).toHaveText('DAWproject imported.');
		await expect(editor).toHaveAttribute('data-clip-count', '1');
		await expect(trackNameText(editor).first()).toHaveText(trackName);
		expect(errors).toEqual([]);
	});

	test('EDL, OpenTimelineIO and FCPXML write the visible video clip and its timing', async ({ page }) => {
		const caseTimeout = 60_000;
		test.setTimeout(caseTimeout * 3);
		const errors = collectClientErrors(page);
		await disableNativeSavePicker(page);
		const editor = await bootEditor(page, '/framescaper/embed/en/');
		await importFiles(editor, [createDeterministicAvFixture('interchange.webm')]);
		for (const [label, extension] of [
			['Export edit list (EDL)', 'edl'], ['Export OpenTimelineIO', 'otio'], ['Export FCPXML', 'fcpxml'],
		]) await test.step(label, async () => {
			const downloadPromise = page.waitForEvent('download');
			await chooseNestedCommandAction(page, editor, 'File', ['Export other', label]);
			const download = await downloadPromise;
			expect(download.suggestedFilename()).toMatch(new RegExp(`\\.${extension}$`));
			const text = await readFile(await download.path(), 'utf8');
			if (extension === 'edl') {
				expect(text).toMatch(/FCM: NON-DROP FRAME/);
				expect(text).toMatch(/001\s+\S+\s+V\s+C\s+\d{2}:\d{2}:\d{2}:\d{2}/);
			} else if (extension === 'otio') {
				const document = JSON.parse(text);
				expect(document.OTIO_SCHEMA).toBe('Timeline.1');
				const clips = document.tracks.children.find((track) => track.kind === 'Video').children;
				expect(clips).toHaveLength(1);
				expect(clips[0].OTIO_SCHEMA).toBe('Clip.1');
				expect(clips[0].source_range.duration.value / clips[0].source_range.duration.rate).toBeCloseTo(32 / 15, 1);
				expect(clips[0].media_reference.target_url).toBeTruthy();
			} else {
				expect(text).toContain('<fcpxml');
				expect(text).toContain('<asset-clip');
				expect(text).toContain('interchange.webm');
			}
			expect(errors).toEqual([]);
		}, { timeout: caseTimeout });
	});
});
