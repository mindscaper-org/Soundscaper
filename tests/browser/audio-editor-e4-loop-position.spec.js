/* SPDX-License-Identifier: AGPL-3.0-only */
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, collectClientErrors, waitForProjectActivation } from './audio-editor-test-helpers.js';
import { createSoundscaperProject } from '../../src/soundscaper/editor-project.ts';
import { createAudioClip, createAudioSource, createAudioTrack } from '../../src/common/editor/project-media-factory.ts';
import { createProjectStore } from '../../src/common/editor/storage.js';
import { exportScapeProject } from '../../src/common/editor/scape-project.js';

test('turning off a repeated loop continues from the audible position', async ({ page }) => {
	const errors = collectClientErrors(page);
	await page.addInitScript(() => {
		globalThis.__loopPositionStarts = [];
		const start = AudioBufferSourceNode.prototype.start;
		AudioBufferSourceNode.prototype.start = function (...args) {
			if (this.context instanceof AudioContext) globalThis.__loopPositionStarts.push({ context: this.context,
				when: args[0] ?? 0, offset: args[1] ?? 0, observed: this.context.currentTime });
			return Reflect.apply(start, this, args);
		};
	});
	const source = createAudioSource({ id: 'source', sampleRate: 48_000, frameCount: 144_000, channelCount: 1 });
	const project = createSoundscaperProject({ id: 'loop-position', loop: { enabled: true, startFrame: 0, endFrame: 48_000 },
		sources: [source], clips: [createAudioClip({ id: 'clip', sourceId: source.id, durationFrames: 144_000, sourceDurationFrames: 144_000 })],
		tracks: [createAudioTrack({ id: 'voice', name: 'Voice', clipIds: ['clip'] })] });
	const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: crypto.randomUUID() }); let file;
	try {
		const writer = await store.beginSourceWrite(source.storageKey, source);
		for (let offset = 0; offset < source.frameCount; offset += source.chunkFrames) await writer.write([
			Float32Array.from({ length: Math.min(source.chunkFrames, source.frameCount - offset) },
				(_, frame) => .25 * Math.sin(2 * Math.PI * 440 * (frame + offset) / 48_000)),
		]);
		await writer.commit(); const archive = await exportScapeProject(project, store);
		expect(archive.blob).toBeInstanceOf(Blob);
		file = { name: 'Loop.sscape', mimeType: 'application/zip', buffer: Buffer.from(await archive.blob.arrayBuffer()) };
	} finally { await store.close(); }
	const editor = await bootEditor(page, '/embed/en/'); await editor.locator('[data-aup4-input]').setInputFiles(file);
	await expect(editor).toHaveAttribute('data-project-id', project.id); await waitForProjectActivation(editor);
	const loop = editor.getByRole('button', { name: 'Loop selection', exact: true }); await expect(loop).toHaveAttribute('aria-pressed', 'true');
	await editor.getByRole('button', { name: 'Play', exact: true }).click();
	await expect.poll(() => page.evaluate(() => {
		const first = globalThis.__loopPositionStarts[0]; if (!first) return false;
		const elapsed = first.context.currentTime - first.when;
		return elapsed > 1 && elapsed % 1 > .2 && elapsed % 1 < .4;
	}), { intervals: [25] }).toBe(true);
	const count = await page.evaluate(() => globalThis.__loopPositionStarts.length);
	await loop.click(); await expect(loop).toHaveAttribute('aria-pressed', 'false');
	await expect.poll(() => page.evaluate(count => globalThis.__loopPositionStarts.slice(count)
		.filter(value => value.when - value.observed < .25).map(value => value.offset), count)).not.toHaveLength(0);
	const offsets = await page.evaluate(count => globalThis.__loopPositionStarts.slice(count)
		.filter(value => value.when - value.observed < .25).map(value => value.offset), count);
	for (const offset of offsets) { expect(offset).toBeGreaterThan(.1); expect(offset).toBeLessThan(.8); }
	await editor.getByRole('button', { name: 'Stop', exact: true }).click();
	expect(errors).toEqual([]);
});
