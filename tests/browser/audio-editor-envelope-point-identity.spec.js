/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, disableNativeSavePicker } from './audio-editor-test-helpers.js';
import { persistedProject } from './helpers/complex-editing-workflows.js';
import { exportSamples } from './helpers/round2-audio-export.js';
import { createAudioClip, createAudioSource, createAudioTrack } from '../../src/common/editor/project-media-factory.ts';
import { createSoundscaperProject } from '../../src/soundscaper/editor-project.ts';
import { createSoundscaperProjectStore } from '../../src/soundscaper/editor-project-store.ts';
import { exportScapeProject } from '../../src/common/editor/scape-project.js';

for (const extraMove of [true, false]) test(`crossing a Clip gain point preserves the authored moved point and audio (extra move:${extraMove})`, async ({ page }) => {
	await disableNativeSavePicker(page);
	const source = createAudioSource({ id: 'source', name: 'Envelope recording', storageKey: `envelope-source-${extraMove}`, sampleRate: 48_000, frameCount: 48_000, channelCount: 1 });
	const clip = createAudioClip({ id: 'clip', title: 'Envelope recording', sourceId: source.id, timelineStartFrame: 0, durationFrames: 48_000,
		sourceStartFrame: 0, sourceDurationFrames: 48_000, envelope: [{ frame: 9_600, value: 1 }, { frame: 19_200, value: .25 }, { frame: 38_400, value: 1 }] });
	const track = createAudioTrack({ id: 'track', name: 'Envelope recording', clipIds: [clip.id] });
	const project = createSoundscaperProject({ id: `envelope-eating-${extraMove}`, sampleRate: 48_000, sources: [source], clips: [clip], tracks: [track] });
	const store = createSoundscaperProjectStore({ indexedDB: null, preferOpfs: false });
	let archive;
	try {
		const writer = await store.beginSourceWrite(source.storageKey, source);
		await writer.write([Float32Array.from({ length: 48_000 }, (_, frame) => .2 * Math.sin(2 * Math.PI * 440 * frame / 48_000))]);
		await writer.commit(); archive = (await exportScapeProject(project, store)).blob;
	} finally { await store.close(); }
	if (!archive) throw new Error('Native envelope project did not export');
	const editor = await bootEditor(page, '/embed/en/');
	await editor.locator('[data-aup4-input]').setInputFiles({ name: 'Authored envelope.sscape', mimeType: 'application/zip', buffer: Buffer.from(await archive.arrayBuffer()) });
	await expect(editor).toHaveAttribute('data-project-id', project.id);
	const rowClip = editor.locator('[data-clip-id="clip"]');
	await rowClip.locator('.clip-header').click();
	await editor.getByRole('button', { name: 'Fit project', exact: true }).click();
	await editor.getByRole('button', { name: 'Clip gain', exact: true }).click();
	const points = rowClip.locator('.envelope-point'); await expect(points).toHaveCount(3);
	const first = await points.nth(0).boundingBox(), second = await points.nth(1).boundingBox(), third = await points.nth(2).boundingBox();
	if (!first || !second || !third) throw new Error('Authored gain points are not visible');
	const x = first.x + first.width / 2, y = first.y + first.height / 2;
	const target = (second.x + second.width / 2 + third.x + third.width / 2) / 2;
	await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(target, y);
	await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
	if (extraMove) await page.mouse.move(target + 4, y);
	await page.mouse.up();
	await expect.poll(async () => (await persistedProject(page, project.id)).clips[0].envelope.length).toBe(2);
	const saved = (await persistedProject(page, project.id)).clips[0].envelope;
	const samples = await exportSamples(page, editor);
	const rms = Math.sqrt(samples.reduce((sum, sample) => sum + sample * sample, 0) / samples.length);
	console.log({ extraMove, saved, rms, samples: samples.length });
	expect(saved.some(point => point.frame === 19_200)).toBe(false);
	expect(saved.some(point => point.frame > 24_000 && point.frame < 34_000 && point.value > .95)).toBe(true);
	// Default mono-center routing contributes sqrt(1/2) to each stereo output.
	expect(rms).toBeGreaterThan(.099);
	expect(rms).toBeLessThan(.1001);
});
