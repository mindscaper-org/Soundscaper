/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseCommandAction, chooseNestedCommandAction, collectClientErrors, disableNativeSavePicker } from './audio-editor-test-helpers.js';
import { persistedProject } from './helpers/complex-editing-workflows.js';
import { createAudioClip, createAudioSource, createAudioTrack } from '../../src/common/editor/project-media-factory.ts';
import { createSoundscaperProject } from '../../src/soundscaper/editor-project.ts';
import { createSoundscaperEphemeralProjectStore } from '../../src/soundscaper/editor-project-store.ts';
import { exportScapeProject } from '../../src/common/editor/scape-project.js';
import { createEnvelopeValueEvaluator } from '../../src/common/editor/automation.js';

async function podcastArchive({ splitCleanPickup = false, wideOverlay = false } = {}) {
	const rate = 48000, length = rate * 8;
	const voice = seed => {
		let state = seed, smooth = 0;
		return Float32Array.from({ length }, () => {
			state = Math.imul(state, 1664525) + 1013904223 | 0;
			smooth = .95 * smooth + .05 * state / 2 ** 31;
			return smooth;
		});
	};
	const a = voice(23), b = voice(701);
	for (let frame = 0; frame < length; frame++) {
		if (frame >= rate * 4) a[frame] = 0;
		if (frame < rate * 2 || frame >= rate * 6) b[frame] = 0;
	}
	const samples = [Float32Array.from(a, (value, frame) => value + .2 * (b[frame - 192] ?? 0)),
		Float32Array.from(b, (value, frame) => value + .2 * (a[frame - 192] ?? 0))];
	const sources = ['Alice', 'Bob'].map((name, index) => createAudioSource({ id: `source-${index}`, name,
		storageKey: `microphone-${index}`, sampleRate: rate, frameCount: length, channelCount: 1 }));
	const pickupFrame = rate * 4.5;
	const clips = sources.map((source, index) => {
		const durationFrames = splitCleanPickup && index === 1 ? pickupFrame : length;
		return createAudioClip({ id: `clip-${index}`, title: source.name, sourceId: source.id,
			timelineStartFrame: 0, durationFrames, sourceStartFrame: 0, sourceDurationFrames: durationFrames,
			envelope: [{ frame: 0, value: index ? .6 : .8 }, { frame: durationFrames, value: index ? .6 : .8 }] });
	});
	const tracks = clips.map((clip, index) => createAudioTrack({ id: `track-${index}`, name: sources[index].name, clipIds: [clip.id] }));
	if (splitCleanPickup) {
		clips.push(createAudioClip({ id: 'clean-pickup', title: 'Bob clean pickup', sourceId: sources[1].id,
			timelineStartFrame: pickupFrame, durationFrames: length - pickupFrame,
			sourceStartFrame: pickupFrame, sourceDurationFrames: length - pickupFrame }));
		tracks[1] = createAudioTrack({ id: 'track-1', name: 'Bob', clipIds: ['clip-1', 'clean-pickup'] });
	}
	if (wideOverlay) {
		const frames = rate / 2;
		const source = createAudioSource({ id: 'wide-source', storageKey: 'wide-source', name: 'Surround overlay',
			sampleRate: rate, frameCount: frames, channelCount: 6 });
		sources.push(source);
		samples.push(new Float32Array(frames));
		clips.push(createAudioClip({ id: 'wide-overlay', title: source.name, sourceId: source.id,
			timelineStartFrame: rate * 3, durationFrames: frames, sourceStartFrame: 0, sourceDurationFrames: frames }));
		tracks[0] = createAudioTrack({ id: 'track-0', name: 'Alice', clipIds: ['clip-0', 'wide-overlay'] });
	}
	const project = createSoundscaperProject({ id: 'microphone-bleed-podcast', sampleRate: rate, sources, clips, tracks,
		...(wideOverlay ? { selection: { startFrame: 0, endFrame: length, trackIds: ['track-0', 'track-1'], clipIds: ['clip-0', 'clip-1'] } } : {}) });
	const store = createSoundscaperEphemeralProjectStore();
	try {
		for (let index = 0; index < sources.length; index++) {
			const writer = await store.beginSourceWrite(sources[index].storageKey, sources[index]);
			for (let start = 0; start < samples[index].length; start += 65536) {
				const pcm = samples[index].subarray(start, start + 65536);
				await writer.write(Array.from({ length: sources[index].channelCount }, () => pcm));
			}
			await writer.commit();
		}
		const archive = await exportScapeProject(project, store);
		return { project, buffer: Buffer.from(await archive.blob.arrayBuffer()) };
	} finally { await store.close(); }
}

test('bleed reduction leaves a separate clean clip on the same microphone unchanged', async ({ page }) => {
	const { project, buffer } = await podcastArchive({ splitCleanPickup: true });
	const editor = await bootEditor(page, '/embed/en/', { showProjectBin: false });
	await editor.locator('[data-aup4-input]').setInputFiles({ name: 'Podcast.sscape', mimeType: 'application/zip', buffer });
	await expect(editor).toHaveAttribute('data-project-id', project.id);
	await chooseCommandAction(page, editor, 'Select', 'Select all');
	await chooseNestedCommandAction(page, editor, 'Effect', ['Noise removal and repair', 'Automatic microphone-bleed reduction']);
	const dialog = page.getByRole('dialog', { name: 'Automatic microphone-bleed reduction', exact: true });
	await dialog.getByRole('button', { name: 'Create gain envelopes', exact: true }).click();
	await expect(dialog).toBeHidden();
	await expect.poll(async () => (await persistedProject(page, project.id)).clips.find(clip => clip.id === 'clip-1').envelope.length).toBeGreaterThan(2);
	const processed = await persistedProject(page, project.id);
	expect(processed.clips.find(clip => clip.id === 'clean-pickup').envelope).toEqual([]);
});

test('bleed reduction ignores overlapping surround audio outside the explicit clip selection', async ({ page }) => {
	const { project, buffer } = await podcastArchive({ wideOverlay: true });
	const editor = await bootEditor(page, '/embed/en/', { showProjectBin: false });
	await editor.locator('[data-aup4-input]').setInputFiles({ name: 'Podcast.sscape', mimeType: 'application/zip', buffer });
	await expect(editor).toHaveAttribute('data-project-id', project.id);
	await chooseNestedCommandAction(page, editor, 'Effect', ['Noise removal and repair', 'Automatic microphone-bleed reduction']);
	const dialog = page.getByRole('dialog', { name: 'Automatic microphone-bleed reduction', exact: true });
	await dialog.getByRole('button', { name: 'Create gain envelopes', exact: true }).click();
	await expect(dialog).toBeHidden();
	await expect.poll(async () => (await persistedProject(page, project.id)).clips.find(clip => clip.id === 'clip-1').envelope.length).toBeGreaterThan(2);
	expect((await persistedProject(page, project.id)).clips.find(clip => clip.id === 'wide-overlay').envelope).toEqual([]);
});

test('microphone bleed creates editable gain envelopes, preserves overlap and sources, and supports undo and reopening', async ({ page }) => {
	const errors = collectClientErrors(page);
	await disableNativeSavePicker(page);
	const { project, buffer } = await podcastArchive();
	const editor = await bootEditor(page, '/embed/en/', { showProjectBin: false });
	await editor.locator('[data-aup4-input]').setInputFiles({ name: 'Podcast.sscape', mimeType: 'application/zip', buffer });
	await expect(editor).toHaveAttribute('data-project-id', project.id);
	await chooseCommandAction(page, editor, 'Select', 'Select all');
	const open = async () => {
		await chooseNestedCommandAction(page, editor, 'Effect', ['Noise removal and repair', 'Automatic microphone-bleed reduction']);
		return page.getByRole('dialog', { name: 'Automatic microphone-bleed reduction', exact: true });
	};
	let dialog = await open();
	await expect(dialog.getByText(/editable clip gain envelopes/)).toBeVisible();
	await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
	await expect.poll(async () => (await persistedProject(page, project.id)).clips[1].envelope).toEqual(project.clips[1].envelope);
	dialog = await open();
	await dialog.getByRole('button', { name: 'Create gain envelopes', exact: true }).click();
	await expect(dialog).toBeHidden();
	await expect.poll(async () => (await persistedProject(page, project.id)).clips.every(clip => clip.envelope.length > 2)).toBe(true);
	const processed = await persistedProject(page, project.id);
	for (let index = 0; index < 2; index++) {
		const gain = createEnvelopeValueEvaluator(processed.clips[index].envelope, 384000), original = index ? .6 : .8;
		expect(gain(48000 * (index ? 1 : 5))).toBeCloseTo(original * 10 ** (-12 / 20), 4);
		expect(gain(48000 * 3)).toBeCloseTo(original, 4);
		expect(gain(48000 * 7)).toBeCloseTo(original, 4);
	}
	expect(processed.clips.map(clip => clip.sourceId)).toEqual(project.clips.map(clip => clip.sourceId));
	expect(processed.sources).toHaveLength(2);
	expect(processed.tracks).toEqual(project.tracks);
	expect(processed.automationLanes).toEqual(project.automationLanes);
	await editor.getByRole('button', { name: 'Undo', exact: true }).click();
	await expect.poll(async () => (await persistedProject(page, project.id)).clips.map(clip => clip.envelope)).toEqual(project.clips.map(clip => clip.envelope));
	await editor.getByRole('button', { name: 'Redo', exact: true }).click();
	await expect.poll(async () => (await persistedProject(page, project.id)).clips.map(clip => clip.envelope)).toEqual(processed.clips.map(clip => clip.envelope));
	await page.reload();
	await expect(editor).toHaveAttribute('data-editor-ready', 'true');
	await expect(editor).toHaveAttribute('data-project-id', project.id);
	expect((await persistedProject(page, project.id)).clips.map(clip => clip.envelope)).toEqual(processed.clips.map(clip => clip.envelope));
	await editor.getByRole('button', { name: 'Fit project', exact: true }).click();
	const bob = editor.locator('[data-clip-id="clip-1"]');
	await bob.locator('.clip-header').click();
	await editor.getByRole('button', { name: 'Clip gain', exact: true }).click();
	const point = bob.locator('.envelope-point').nth(2);
	await expect(point).toBeVisible();
	const box = await point.boundingBox();
	if (!box) throw new Error('The generated clip gain point is unavailable.');
	await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
	await page.mouse.down(); await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 - 12); await page.mouse.up();
	await expect.poll(async () => JSON.stringify((await persistedProject(page, project.id)).clips[1].envelope)).not.toBe(JSON.stringify(processed.clips[1].envelope));
	expect((await persistedProject(page, project.id)).clips[1].sourceId).toBe('source-1');
	expect(errors).toEqual([]);
});
