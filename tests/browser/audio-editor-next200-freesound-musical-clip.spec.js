/* SPDX-License-Identifier: AGPL-3.0-only */

import { createSoundscaperProject } from '../../src/soundscaper/editor-project.ts';
import { createSoundscaperScapeNativeRuntime } from '../../src/soundscaper/editor-scape-native.ts';
import { createAudioClip, createAudioSource, createAudioTrack } from '../../src/common/editor/project-media-factory.ts';
import { createProjectStore } from '../../src/common/editor/storage.js';
import { inspectWavBlobPcm, streamWavBlobPcm } from '../../src/common/editor/wav-import.js';
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, waitForProjectActivation } from './audio-editor-test-helpers.js';

for (const [musical, bin, linked] of [[true, false, false], [true, true, false], [false, false, false], [false, true, false], [true, true, true], [false, true, true]]) {
	test(`Freesound uploads a ${musical ? 'musical' : 'sample'} clip from ${bin ? 'Project Bin' : 'the timeline'}${linked ? ' with linked pitch' : ''}`, async ({ page }) => {
		await page.addInitScript(() => {
			const fetch = globalThis.fetch; globalThis.__musicalUploadBytes = [];
			globalThis.fetch = async (input, init) => {
				if (new URL(String(input), location.href).pathname === '/api/freesound/uploads' && init?.body instanceof Blob) {
					globalThis.__musicalUploadName = init.body.name;
					globalThis.__musicalUploadBytes = Array.from(new Uint8Array(await init.body.arrayBuffer()));
				}
				return Reflect.apply(fetch, globalThis, [input, init]);
			};
		});
		await page.route('**/api/freesound/**', async route => {
			const pathname = new URL(route.request().url()).pathname;
			if (pathname.endsWith('/oauth/session')) return route.fulfill({ json: { data: { connected: true, user: { id: 7, username: 'recorder' } } } });
			if (pathname.endsWith('/uploads/pending')) return route.fulfill({ json: { data: { pendingDescription: [], pendingProcessing: [], pendingModeration: [] } } });
			if (pathname.endsWith('/uploads')) return route.fulfill({ status: 201, json: { data: { uploadFilename: 'remote-take.wav' } } });
			return route.fulfill({ status: 404, json: {} });
		});
		const tempoMap = { mode: 'musical', events: [{ id: 'tempo', beat: { num: 0, den: 1 }, bpm: { num: 240, den: 1 } }] };
		const source = createAudioSource({ id: 'source', sampleRate: 48_000, frameCount: 48_000, channelCount: 1 });
		const title = !musical && !bin && !linked ? `${'A'.repeat(219)}🎙` : 'Beat take';
		const clip = createAudioClip({ id: 'clip', sourceId: source.id, title, sourceStartFrame: 0,
			sourceDurationFrames: 48_000, linkPitchAndTempo: linked,
			...(musical ? { anchor: 'musical', musicalStartBeat: bin ? 2 : 0, musicalExtent: 'beat', musicalDurationBeats: 2 }
				: { timelineStartFrame: bin ? 24_000 : 0, durationFrames: 24_000, speedRatio: 2 }),
			...(bin ? { binItemId: 'clip' } : {}) }, { projectSampleRate: 48_000, tempoMap });
		const project = createSoundscaperProject({ id: `upload-${musical}-${bin}`, sampleRate: 48_000, tempoMap,
			sources: [source], clips: bin ? [] : [clip], projectBin: { clips: bin ? [clip] : [] },
			tracks: [createAudioTrack({ id: 'voice', clipIds: bin ? [] : ['clip'] })] });
		const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: crypto.randomUUID() }); let buffer;
		try {
			const writer = await store.beginSourceWrite(source.storageKey, source);
			await writer.write([Float32Array.from({ length: 48_000 }, (_, frame) => .25 * Math.sin(2 * Math.PI * 1000 * frame / 48_000))]);
			await writer.commit(); const archive = await createSoundscaperScapeNativeRuntime().exportScapeProject(project, store);
			buffer = Buffer.from(await archive.blob.arrayBuffer());
		} finally { await store.close(); }
		const editor = await bootEditor(page, '/embed/en/');
		await editor.locator('[data-aup4-input]').setInputFiles({ name: 'Take.sscape', mimeType: 'application/zip', buffer });
		await expect(editor).toHaveAttribute('data-project-id', project.id); await waitForProjectActivation(editor);
		if (!bin) await chooseCommandAction(page, editor, 'Window', 'Project bin');
		await chooseCommandAction(page, editor, 'Window', 'Freesound');
		const panel = editor.locator('[data-workspace-panel="freesound"]');
		await expect(panel.getByText('Connected as recorder', { exact: true })).toBeVisible();
		if (bin) {
			await editor.locator('[data-project-bin-item]').getByRole('button', { name: /^More file actions:/u }).press('Enter');
			await page.locator('.kw-audio-editor__project-bin-menu').getByRole('menuitem', { name: 'Upload clip to Freesound', exact: true }).press('Enter');
		} else {
			await editor.getByRole('button', { name: 'Fit project', exact: true }).click();
			await editor.locator('[data-clip-id="clip"] .clip-header').click({ button: 'right' });
			await page.locator('.audio-editor-clip-context-menu').getByRole('menuitem', { name: 'Upload clip to Freesound', exact: true }).press('Enter');
		}
		await expect(panel.locator('[data-upload-status="ready-to-publish"]')).toHaveCount(1);
		expect(await page.evaluate(() => globalThis.__musicalUploadName)).toBe(`${title}.wav`);
		const wav = new Blob([Uint8Array.from(await page.evaluate(() => globalThis.__musicalUploadBytes))]);
		const descriptor = await inspectWavBlobPcm(wav); expect(descriptor.frameCount).toBe(24_000); expect(descriptor.sampleRate).toBe(48_000); expect(descriptor.channelCount).toBe(2);
		const samples = []; await streamWavBlobPcm(wav, { onChunk: channels => { samples.push(...channels[0]); } });
		let real = 0, imaginary = 0;
		for (let frame = 6000; frame < 18_000; frame++) {
			real += samples[frame] * Math.cos(2 * Math.PI * (linked ? 2000 : 1000) * frame / 48_000);
			imaginary += samples[frame] * Math.sin(2 * Math.PI * (linked ? 2000 : 1000) * frame / 48_000);
		}
		expect(Math.hypot(real, imaginary) / 6000).toBeGreaterThan(.1);
	});
}
