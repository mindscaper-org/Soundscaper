/* SPDX-License-Identifier: AGPL-3.0-only */

import { EDITOR_ENGLISH_COPY } from '../../src/common/i18n/editor-copy-inventory.ts';
import { createWavFixture, expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseFileAction, chooseNestedCommandAction, closeDialog, importFiles, waitForProjectActivation } from './audio-editor-test-helpers.js';
import { hasWebGl2Capability } from './helpers/webgl2-capability.js';
import { createFramescaperProject } from '../../src/framescaper/editor-project.ts';
import { createFramescaperProjectStore } from '../../src/framescaper/editor-project-store.ts';
import { createFramescaperScapeNativeRuntime } from '../../src/framescaper/editor-scape-native.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE as PROFILE } from '../../src/framescaper/editor-project-runtime-profile.ts';

test('visualizer foreground over background matches the same native solid-layer composition', async ({ page }) => {
	test.setTimeout(60_000);
	await page.addInitScript(() => {
		globalThis.__visualizerColors = null;
		const frames = new WeakMap();
		const put = CanvasRenderingContext2D.prototype.putImageData;
		CanvasRenderingContext2D.prototype.putImageData = function (...args) {
			const result = Reflect.apply(put, this, args), image = args[0];
			if (image.width !== 1280 || image.height !== 720) return result;
			const pixel = y => Array.from(image.data.subarray((y * image.width + 640) * 4, (y * image.width + 640) * 4 + 4));
			frames.set(this.canvas, { line: pixel(719), center: pixel(360) });
			return result;
		};
		// A preview render also writes generator intermediates; publish only the
		// exact frame that the maintained WebGL preview consumes.
		for (const prototype of [WebGLRenderingContext.prototype, WebGL2RenderingContext.prototype]) {
			for (const name of ['texImage2D', 'texSubImage2D']) {
				const upload = prototype[name];
				prototype[name] = function (...args) {
					const result = Reflect.apply(upload, this, args);
					for (const source of args) {
						const colors = source && typeof source === 'object' ? frames.get(source) : null;
						if (colors) globalThis.__visualizerColors = colors;
					}
					return result;
				};
			}
		}
	});
	const editor = await bootEditor(page, '/framescaper/embed/en/');
	test.skip(!await page.evaluate(hasWebGl2Capability), 'Color parity requires the maintained exact WebGL2 preview.');
	await importFiles(editor, [createWavFixture({ name: 'Quiet.wav', frequency: 440, duration: 1, channelCount: 1, channelAmplitudes: [0] })]);
	await chooseNestedCommandAction(page, editor, 'Generate', ['Video Generators', EDITOR_ENGLISH_COPY['ui.framescaperMenus.addSoundVisualizer']]);
	await editor.getByRole('group', { name: 'Video clip: Sound Visualizer', exact: true }).press('Enter');
	await chooseNestedCommandAction(page, editor, 'Effect', ['Video Finishing', EDITOR_ENGLISH_COPY['ui.framescaperMenus.videoVisualInspector']]);
	const dialog = page.getByRole('dialog', { name: 'Selected Visual Inspector', exact: true });
	await dialog.getByRole('combobox', { name: 'Visualization', exact: true }).selectOption('spectrum');
	await dialog.getByRole('textbox', { name: 'Foreground RGBA color', exact: true }).fill('#ff000080');
	await dialog.getByRole('textbox', { name: 'Background RGBA color', exact: true }).fill('#00ff00ff');
	await dialog.getByRole('button', { name: 'Apply', exact: true }).click();
	await expect(dialog.getByRole('status').last()).toHaveText('Selected visual updated.');
	await expect.poll(() => page.evaluate(() => globalThis.__visualizerColors?.center)).toEqual([0, 255, 0, 255]);
	await expect.poll(() => page.evaluate(() => globalThis.__visualizerColors?.line[0] ?? 0)).toBeGreaterThan(0);
	const visualizer = await page.evaluate(() => globalThis.__visualizerColors.line);
	await closeDialog(dialog);
	const project = createFramescaperProject(PROFILE, { id: 'linear-solid-reference', primarySequenceId: 'main',
		visualModel: { generatorSources: ['#ff000080', '#00ff00ff'].map((color, index) => ({
			schemaVersion: 1, kind: 'generator', id: `source-${index}`, name: `Solid ${index}`,
			width: 1920, height: 1080, frameRate: { num: 30, den: 1 }, frameCount: 30, generator: { kind: 'solid', color },
		})) },
		clips: [0, 1].map(index => ({ schemaVersion: 1, kind: 'generator', id: `clip-${index}`, sourceId: `source-${index}`,
			sequenceId: 'main', sequenceStartFrame: 0, sequenceFrameCount: 30, sourceInFrame: 0, sourceFrameCount: 30 })),
		tracks: [0, 1].map(index => ({ id: `track-${index}`, type: 'video', clipIds: [`clip-${index}`] })),
		sequences: [{ id: 'main', rate: { num: 30, den: 1 }, trackIds: ['track-0', 'track-1'] }],
	});
	const archive = await createFramescaperScapeNativeRuntime(PROFILE).exportScapeProject(project,
		createFramescaperProjectStore(PROFILE, { indexedDB: null, preferOpfs: false }));
	const choosing = page.waitForEvent('filechooser'); await chooseFileAction(page, editor, 'Open');
	await (await choosing).setFiles({ name: 'Layer reference.fscape', mimeType: 'application/zip', buffer: Buffer.from(await archive.blob.arrayBuffer()) });
	await expect(editor).toHaveAttribute('data-project-id', project.id, { timeout: 30_000 }); await waitForProjectActivation(editor);
	// Native layers quantize their linear source-over result to Rec.709 delivery
	// bytes before the preview converts that retained output to display sRGB.
	const displayMidtones = [128 / 255, 127 / 255].map(coverage => {
		const deliveryByte = Math.round(255 * (1.099 * coverage ** .45 - .099));
		const linear = ((deliveryByte / 255 + .099) / 1.099) ** (1 / .45);
		return Math.round(255 * (1.055 * linear ** (1 / 2.4) - .055));
	});
	await expect.poll(() => page.evaluate(() => globalThis.__visualizerColors?.center)).toEqual([...displayMidtones, 0, 255]);
	const nativeLayers = await page.evaluate(() => globalThis.__visualizerColors.center);
	// The generator's intermediate RGBA8 representation permits one output LSB
	// versus the native composition's floating-point working buffer.
	for (let component = 0; component < 4; component++) {
		expect(Math.abs(visualizer[component] - nativeLayers[component]),
			'identical RGBA source-over must use the same managed working space').toBeLessThanOrEqual(1);
	}
});
