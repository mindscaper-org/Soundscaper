/* SPDX-License-Identifier: AGPL-3.0-only */
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseFileAction, openExportDialog, waitForProjectActivation } from './audio-editor-test-helpers.js';
import { installLinkedAudioBridge } from './helpers/linked-audio-relink-fixture.js';
import { encodeWav } from '../../src/common/editor/wav.js';

import { persistedProject } from './helpers/complex-editing-workflows.js';

test('desktop SESX channel maps preserve physical stereo and truthful import accounting', async ({ page }) => {
	test.setTimeout(120_000);
	let editor;
	for (const map of ['subset', 'full']) {
		await test.step(`${map} channel map native import, report, and output`, async () => {
			if (!editor) {
				const wave = Buffer.from(encodeWav([new Float32Array(4800).fill(.125), new Float32Array(4800).fill(.375)], { sampleRate: 48000, float: true }));
				const media = { name: 'Stereo.wav', mimeType: 'audio/wav', buffer: wave };
				await installLinkedAudioBridge(page, { original: media, changed: media });
				const variants = ['subset', 'full', 'swapped'].map(map => {
					const indices = map === 'subset' ? [0] : map === 'full' ? [0, 1] : [1, 0];
					const xml = `<sesx><session sampleRate="48000" audioChannelType="stereo"><tracks><audioTrack><trackParameters><name>Selected source channels</name></trackParameters>
	<trackAudioParameters audioChannelType="${map === 'subset' ? 'mono' : 'stereo'}"/><audioClip fileID="0" startPoint="0" endPoint="4800" sourceInPoint="0" sourceOutPoint="4800">
	<channelMap>${indices.map((sourceIndex, index) => `<channel index="${index}" sourceIndex="${sourceIndex}"/>`).join('')}</channelMap>
	</audioClip></audioTrack></tracks></session><files><file id="0" relativePath="Stereo.wav"/></files></sesx>`;
					return { map, xml };
				});
				await page.addInitScript(({ variants, wave }) => {
					const pcm = Uint8Array.from(wave), state = { next: 'subset' };
					const fixtures = variants.map(({ map, xml }, profileIndex) => {
						const text = new TextEncoder().encode(xml);
						const descriptors = [text, pcm].map((body, index) => {
							const id = String(profileIndex * 2 + index + 1).repeat(64);
							return { id, name: index ? 'Stereo.wav' : 'Selection.sesx',
								readProfile: 'selected-range-v1', size: body.length, lastModified: 0, mimeType: index ? 'audio/wav' : 'application/xml',
								url: `soundscaper-app://bundle/_desktop/read/selected-range-v1/${id}/${index ? 'Stereo.wav' : 'Selection.sesx'}` };
						});
						return { map, text, descriptors };
					});
					const descriptors = fixtures.flatMap(fixture => fixture.descriptors);
					const bodies = fixtures.flatMap(fixture => [fixture.text, pcm]);
					const nativeFetch = globalThis.fetch.bind(globalThis);
					globalThis.fetch = (input, init) => {
						const url = input instanceof Request ? input.url : String(input), index = descriptors.findIndex(({ url: candidate }) => candidate === url);
						if (index < 0) return nativeFetch(input, init);
						const bytes = bodies[index], header = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined)).get('Range');
						const interval = /^bytes=(\d+)-(\d+)$/u.exec(header ?? ''); if (!interval) return Promise.resolve(new Response(null, { status: 416 }));
						const start = Number(interval[1]), end = Number(interval[2]), body = bytes.slice(start, end + 1);
						return Promise.resolve(new Response(body, { status: 206, headers: { 'Accept-Ranges': 'bytes', 'Content-Length': String(body.length),
							'Content-Range': `bytes ${start}-${end}/${bytes.length}`, 'Content-Type': descriptors[index].mimeType } }));
					};
					Object.defineProperty(globalThis, '__sesxChannelMapFixture', { value: state });
					Object.defineProperty(globalThis, 'soundscaperDesktop', { configurable: true, value: { v1: { ...globalThis.soundscaperDesktop.v1,
						chooseFiles: async () => [fixtures.find(fixture => fixture.map === state.next).descriptors[0]],
						resolveSesxMedia: async ({ sessionReadId }) => {
							const fixture = fixtures.find(fixture => fixture.descriptors[0].id === sessionReadId);
							return fixture ? { status: 'found', descriptor: fixture.descriptors[1] } : { status: 'missing' };
						},
						chooseSesxMediaFolder: async () => ({ status: 'cancelled' }), releaseSesxSession: async () => true } } });
				}, { variants, wave: [...wave] });
				editor = await bootEditor(page, '/embed/en/');
			} else {
				const previousProjectId = await editor.getAttribute('data-project-id');
				await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');
				await editor.getByRole('button', { name: 'New project', exact: true }).click();
				await expect(editor).not.toHaveAttribute('data-project-id', previousProjectId);
				await waitForProjectActivation(editor);
				await expect(editor).toHaveAttribute('data-editor-ready', 'true');
				await expect(editor).toHaveAttribute('data-clip-count', '0');
				const projectId = await editor.getAttribute('data-project-id');
				await expect.poll(async () => (await persistedProject(page, projectId))?.sources.length).toBe(0);
			}
			await page.evaluate(map => {
				globalThis.__sesxChannelMapFixture.next = map;
				// Retire only completed-output observations; every phase still renders.
				globalThis.__projectBinLinkedAudioFixture.exports.length = 0;
			}, map);
			await chooseFileAction(page, editor, 'Open');
			await expect(editor).toHaveAttribute('data-clip-count', '1', { timeout: 20_000 });
			await chooseFileAction(page, editor, 'Delivery Report');
			const report = page.getByRole('dialog', { name: 'Delivery Report', exact: true });
			const importReport = await report.locator('[data-delivery-report]').textContent();
			await report.getByRole('button', { name: 'Close', exact: true }).last().click();
			const dialog = await openExportDialog(page, editor);
			await dialog.getByRole('button', { name: 'Export', exact: true }).click();
			await expect.poll(() => page.evaluate(() => globalThis.__projectBinLinkedAudioFixture.exports.length)).toBe(1);
			const rendered = await page.evaluate(async () => {
				const context = new OfflineAudioContext(2, 1, 48000), bytes = globalThis.__projectBinLinkedAudioFixture.exports[0];
				const buffer = await context.decodeAudioData(Uint8Array.from(bytes).buffer);
				return { channels: buffer.numberOfChannels, frames: buffer.length, left: buffer.getChannelData(0)[1000], right: buffer.getChannelData(1)[1000] };
			});
			expect(rendered).toMatchObject({ channels: 2, frames: 4800 });
			expect(rendered.left).toBeCloseTo(.125, 4); expect(rendered.right).toBeCloseTo(.375, 4);
			expect(importReport.includes('Audition clip channel remapping is not imported.')).toBe(map !== 'full');
			await dialog.getByRole('button', { name: 'Close', exact: true }).click();
			await expect(dialog).toBeHidden();
		}, { timeout: 60_000 });
	}
});
