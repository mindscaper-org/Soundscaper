/* SPDX-License-Identifier: AGPL-3.0-only */
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, disableNativeSavePicker, openSourceMonitor, openClipProperties, closeClipProperties, waitForProjectActivation } from './audio-editor-test-helpers.js';
import { createSoundscaperProject } from '../../src/soundscaper/editor-project.ts';
import { createAudioClip, createAudioSource, createAudioTrack } from '../../src/common/editor/project-media-factory.ts';
import { createProjectStore } from '../../src/common/editor/storage.js';
import { exportScapeProject } from '../../src/common/editor/scape-project.js';
import { exportSamples } from './helpers/round2-audio-export.js';
import { calculateAudioSpectrum } from '../../src/common/editor/audio-spectrum.ts';

const variants = [
	{ name: 'higher programme band', rate: 12_000, frequency: 4000, render: true },
	{ name: 'lower source tone', rate: 12_000, frequency: 1000 },
	{ name: 'higher source clock', rate: 24_000, frequency: 4000 },
	{ name: 'unpitched control', rate: 12_000, frequency: 4000, neutral: true },
	{ name: 'trimmed reversed window', rate: 12_000, frequency: 4000, reversed: true, trimmed: true },
	{ name: 'slower pitched audio', rate: 12_000, frequency: 4000, speed: .5 },
	{ name: 'Source Monitor spectrum', rate: 12_000, frequency: 4000, monitor: true },
];
for (const variant of variants) test(`pitched native audio retains its audible programme clock: ${variant.name}`, async ({ page }) => {
	const source = createAudioSource({ id: 'source', name: 'Native tone', sampleRate: variant.rate, frameCount: variant.rate * 2, channelCount: 1 });
	const rawStart = variant.trimmed ? variant.rate / 4 : 0;
	const rawFrames = variant.trimmed ? variant.rate * 1.5 : source.frameCount;
	const duration = rawFrames * 48_000 / variant.rate / (variant.speed ?? 1);
	const project = createSoundscaperProject({ id: `pitch-clock-${variant.name}`, sampleRate: 48_000, sources: [source],
		clips: [createAudioClip({ id: 'clip', sourceId: source.id, sourceStartFrame: rawStart, sourceDurationFrames: rawFrames,
			durationFrames: duration, pitchCents: variant.neutral ? 0 : 1200, speedRatio: variant.speed ?? 1,
			reversed: Boolean(variant.reversed), fadeInFrames: 480, fadeOutFrames: 480 })],
		tracks: [createAudioTrack({ id: 'voice', name: 'Voice', clipIds: ['clip'] })] });
	const store = createProjectStore({ indexedDB: null, preferOpfs: false, databaseName: crypto.randomUUID() }); let file;
	try {
		const writer = await store.beginSourceWrite(source.storageKey, source);
		await writer.write([Float32Array.from({ length: source.frameCount }, (_, frame) => .3 * Math.sin(2 * Math.PI * variant.frequency * frame / variant.rate))]);
		await writer.commit(); const archive = await exportScapeProject(project, store); expect(archive.blob).toBeInstanceOf(Blob);
		file = { name: 'Pitched.sscape', mimeType: 'application/zip', buffer: Buffer.from(await archive.blob.arrayBuffer()) };
	} finally { await store.close(); }
	await disableNativeSavePicker(page); const editor = await bootEditor(page, '/embed/en/');
	await editor.locator('[data-aup4-input]').setInputFiles(file);
	await expect(editor).toHaveAttribute('data-project-id', project.id); await waitForProjectActivation(editor);
	const output = await exportSamples(page, editor); expect(output).toHaveLength(duration);
	const peak = strongestTone(output); const expected = variant.frequency * (variant.neutral ? 1 : 2);
	expect(peak.frequency).toBeCloseTo(expected, -1); expect(peak.amplitude).toBeGreaterThan(.02);
	if (variant.render) {
		const clip = editor.locator('[data-clip-id="clip"]').first();
		await clip.getByRole('button', { name: 'Clip menu', exact: true }).click();
		await page.locator('.audio-editor-clip-context-menu').getByRole('menuitem', { name: 'Render pitch and speed', exact: true }).click();
		const properties = await openClipProperties(page, editor, clip, { additional: false });
		await expect(properties.getByRole('textbox', { name: 'Pitch', exact: true })).toHaveValue('0');
		await closeClipProperties(properties);
		const rendered = await exportSamples(page, editor); expect(rendered).toHaveLength(duration);
		expect(strongestTone(rendered).frequency).toBeCloseTo(expected, -1);
	}
	if (variant.monitor) {
		const panel = await openSourceMonitor(page, editor, editor.locator('[data-clip-id="clip"]').first());
		const ruler = panel.getByRole('region', { name: 'Source vertical ruler', exact: true });
		await ruler.click({ button: 'right' }); await page.getByRole('menuitem', { name: 'Spectrogram', exact: true }).click();
		await expect(ruler.locator('.vertical-ruler__tick--first .vertical-ruler__label').first()).toHaveText('24k');
		const canvas = panel.locator('[data-source-active="true"] canvas').first();
		await expect(canvas).toHaveAttribute('data-spectrogram-renderer', 'pffft-wasm');
		await expect.poll(() => canvas.evaluate(element => {
			const columns = element.__kwSpectrogramColumnsPlan?.channels?.[0];
			if (!columns?.length) return Infinity;
			const middle = columns[Math.floor(columns.length / 2)];
			return Math.abs((middle.indexOf(Math.max(...middle)) + .5) * 24_000 / middle.length - 8000);
		})).toBeLessThan(100);
	}
});

function strongestTone(output) {
	const data = Float32Array.from(output.slice(24_000, 48_000));
	return calculateAudioSpectrum([data], 48_000, { size: 8192, average: true }).bins
		.reduce((best, bin) => bin.amplitude > best.amplitude ? bin : best);
}
