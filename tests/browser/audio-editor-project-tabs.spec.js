import { rm } from 'node:fs/promises';
import { AxeBuilder, expect, test, toneA, toneB } from './audio-editor-test-fixtures.js';
import { encodeWav } from '../../src/common/editor/wav.js';
import {
	bootEditor,
	chooseCommandAction,
	chooseExportProjectFileAction,
	chooseFileAction,
	chooseNestedCommandAction,
	clipByName,
	collectClientErrors,
	commitInput,
	disableNativeSavePicker,
	getMenuItem,
	importFiles,
	openNestedCommandMenu,
	waitForProjectActivation,
} from './audio-editor-test-helpers.js';
import { exportSamples } from './helpers/round2-audio-export.js';

async function renameProject(page, editor, title) {
	await chooseNestedCommandAction(page, editor, 'File', ['Project management', 'Rename project']);
	const dialog = page.getByRole('dialog', { name: 'Rename project', exact: true });
	await commitInput(dialog.locator('[data-project-name-input] input'), title);
	await dialog.getByRole('button', { name: 'Save name', exact: true }).click();
	await expect(dialog).toHaveCount(0);
	await expect(editor.locator('[data-project-name]')).toHaveText(title);
}

test.describe('project tab close controls', () => {
	test('Window groups projects, workspaces, panels and fullscreen without submenus', async ({ page }) => {
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/');
		await renameProject(page, editor, 'First project');
		await importFiles(editor, [toneA]);
		await editor.getByRole('button', { name: 'New project', exact: true }).click();
		await renameProject(page, editor, 'Second project');

		const view = await openNestedCommandMenu(page, editor, 'View', []);
		await expect(getMenuItem(view, 'Panels')).toHaveCount(0);
		await page.keyboard.press('Escape');
		let window = await openNestedCommandMenu(page, editor, 'Window', []);
		await expect(window.getByRole('separator')).toHaveCount(3);
		await expect(window.getByRole('menu')).toHaveCount(0);
		await expect(getMenuItem(window, 'Fullscreen')).toBeVisible();
		await expect(getMenuItem(window, 'First project')).toHaveAttribute('aria-checked', 'false');
		await expect(getMenuItem(window, 'Second project')).toHaveAttribute('aria-checked', 'true');
		for (const name of ['Soundscaper', 'Audacity', 'Music', 'Classic', 'Clip properties']) {
			await expect(getMenuItem(window, name)).toBeVisible();
		}
		await expect(getMenuItem(window, 'Tracks panel')).toHaveCount(0);
		await getMenuItem(window, 'First project').press('Enter');
		await expect(window).toBeHidden();
		await expect(editor.getByRole('tab', { name: 'First project', exact: true })).toHaveAttribute('aria-selected', 'true');
		await expect(clipByName(editor, toneA.name)).toHaveCount(1);

		await chooseNestedCommandAction(page, editor, 'Window', ['Audacity']);
		await expect(editor).toHaveAttribute('data-workspace-preset', 'audacity');
		window = await openNestedCommandMenu(page, editor, 'Window', []);
		await expect(getMenuItem(window, 'Audacity')).toHaveAttribute('aria-checked', 'true');
		await expect(getMenuItem(window, 'Clock')).toHaveAttribute('aria-checked', 'false');
		await getMenuItem(window, 'Clock').press('Enter');
		const clock = editor.locator('[data-clock-panel]');
		await expect(clock).toBeVisible();
		await chooseNestedCommandAction(page, editor, 'Window', ['Clock']);
		await expect(clock).toBeHidden();

		await editor.getByRole('button', { name: 'Close project: Second project', exact: true }).click();
		window = await openNestedCommandMenu(page, editor, 'Window', []);
		await expect(getMenuItem(window, 'Second project')).toHaveCount(0);
		await expect(getMenuItem(window, 'First project')).toHaveAttribute('aria-checked', 'true');
		expect(errors).toEqual([]);
	});

	test('closes an inactive tab without activating it and preserves its saved audio', async ({ page }) => {
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/');
		await renameProject(page, editor, 'Saved audio');
		await importFiles(editor, [toneA]);
		await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved', { timeout: 10_000 });
		await editor.getByRole('button', { name: 'New project', exact: true }).click();
		await renameProject(page, editor, 'Active blank');
		const projectTabs = editor.getByRole('navigation', { name: 'Project tabs' });
		const accessibility = await new AxeBuilder({ page }).include('nav[aria-label="Project tabs"]')
			.withRules(['aria-required-children', 'aria-required-parent', 'aria-valid-attr-value']).analyze();
		expect(accessibility.violations).toEqual([]);
		const close = projectTabs.getByRole('button', { name: 'Close project: Saved audio', exact: true });
		await expect(close).toHaveText('×');
		await expect(close).not.toHaveAttribute('title');
		await close.hover();
		await expect(editor.locator('[data-audio-editor-button-tooltip]')).toHaveText('Close project: Saved audio');
		await page.mouse.move(0, 0);
		await close.click();

		await expect(projectTabs.getByRole('tab')).toHaveCount(1);
		const active = projectTabs.getByRole('tab', { name: 'Active blank', exact: true });
		await expect(active).toHaveAttribute('aria-selected', 'true');
		await waitForProjectActivation(editor);
		await expect(active).toBeFocused();
		await expect(editor).toHaveAttribute('data-clip-count', '0');

		await chooseNestedCommandAction(page, editor, 'File', ['Project management', 'Local projects']);
		const projects = page.getByRole('dialog', { name: 'Local projects', exact: true });
		await projects.locator('[data-project-list]').getByRole('button', { name: /^Saved audio Last edited:/u }).click();
		await expect(projects).toHaveCount(0);
		await expect(projectTabs.getByRole('tab', { name: 'Saved audio', exact: true })).toHaveAttribute('aria-selected', 'true');
		await waitForProjectActivation(editor);
		await expect(clipByName(editor, toneA.name)).toHaveCount(1);
		expect(errors).toEqual([]);
	});

	test('keyboard closure selects the right neighbor and closing the final tab selects the left', async ({ page }) => {
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/');
		await renameProject(page, editor, 'First');
		await editor.getByRole('button', { name: 'New project', exact: true }).click();
		await renameProject(page, editor, 'Middle');
		await editor.getByRole('button', { name: 'New project', exact: true }).click();
		await renameProject(page, editor, 'Last');
		const projectTabs = editor.getByRole('navigation', { name: 'Project tabs' });
		const middle = projectTabs.getByRole('tab', { name: 'Middle', exact: true });
		await middle.click();
		await expect(middle).toHaveAttribute('aria-selected', 'true');
		await waitForProjectActivation(editor);
		await page.keyboard.press('Tab');
		await expect(projectTabs.getByRole('button', { name: 'Close project: Middle', exact: true })).toBeFocused();
		await page.keyboard.press('Enter');
		await expect(projectTabs.getByRole('tab')).toHaveCount(2);
		const last = projectTabs.getByRole('tab', { name: 'Last', exact: true });
		await expect(last).toHaveAttribute('aria-selected', 'true');
		await waitForProjectActivation(editor);
		await expect(last).toHaveAttribute('tabindex', '0');
		await expect(last).toBeFocused();
		await projectTabs.getByRole('button', { name: 'Close project: Last', exact: true }).click();
		await expect(projectTabs.getByRole('tab')).toHaveCount(1);
		const first = projectTabs.getByRole('tab', { name: 'First', exact: true });
		await expect(first).toHaveAttribute('aria-selected', 'true');
		await waitForProjectActivation(editor);
		await expect(first).toHaveAttribute('tabindex', '0');
		await expect(first).toBeFocused();
		expect(errors).toEqual([]);
	});

	test('closing the only project tab opens a focused blank project', async ({ page }) => {
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/embed/en/');
		await renameProject(page, editor, 'Only project');
		await importFiles(editor, [toneA]);
		const projectTabs = editor.getByRole('navigation', { name: 'Project tabs' });
		await projectTabs.getByRole('button', { name: 'Close project: Only project', exact: true }).click();
		await expect(projectTabs.getByRole('tab', { name: 'Only project', exact: true })).toHaveCount(0);

		const remaining = projectTabs.getByRole('tab');
		await expect(remaining).toHaveCount(1);
		await expect(remaining).not.toHaveText('Only project');
		await expect(remaining).toHaveAttribute('aria-selected', 'true');
		await waitForProjectActivation(editor);
		await expect(remaining).toHaveAttribute('tabindex', '0');
		await expect(remaining).toBeFocused();
		await expect(editor).toHaveAttribute('data-clip-count', '0');
		expect(errors).toEqual([]);
	});

	test('a refused keyboard close returns focus to the surviving close button', async ({ page }) => {
		const editor = await bootEditor(page, '/embed/en/');
		await renameProject(page, editor, 'Unavailable neighbor');
		const neighborId = await editor.getAttribute('data-project-id');
		await editor.getByRole('button', { name: 'New project', exact: true }).click();
		await waitForProjectActivation(editor);
		await renameProject(page, editor, 'Remains open');
		await page.evaluate(id => {
			const read = IDBObjectStore.prototype.get;
			IDBObjectStore.prototype.get = function (key) {
				if (this.name === 'projects' && key === id) {
					IDBObjectStore.prototype.get = read;
					throw new DOMException('The next tab could not be read.', 'UnknownError');
				}
				return read.call(this, key);
			};
		}, neighborId);
		const close = editor.getByRole('button', { name: 'Close project: Remains open', exact: true });
		await close.focus();
		await page.keyboard.press('Enter');
		await expect(editor.getByRole('alert')).toContainText('The next tab could not be read.');
		await expect(editor.getByRole('tab', { name: 'Remains open', exact: true })).toHaveAttribute('aria-selected', 'true');
		await expect(close).toBeEnabled();
		await expect(close).toBeFocused();
	});
});

test('reopened projects keep track visualization scoped to their tabs and history', async ({ page }, result) => {
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/', { showProjectBin: false });
	await renameProject(page, editor, 'Archived waveform');
	await importFiles(editor, [toneA]);
	const downloading = page.waitForEvent('download');
	await chooseExportProjectFileAction(page, editor);
	const download = await downloading;
	const archivePath = result.outputPath(download.suggestedFilename());
	try {
		await download.saveAs(archivePath);
		await chooseFileAction(page, editor, 'New');
		await waitForProjectActivation(editor);
		await renameProject(page, editor, 'Other waveform');
		await importFiles(editor, [toneB]);
		const choosing = page.waitForEvent('filechooser');
		await chooseFileAction(page, editor, 'Open');
		await (await choosing).setFiles(archivePath);
		await expect(editor.getByRole('tab', { name: 'Archived waveform', exact: true })).toHaveAttribute('aria-selected', 'true');
		await waitForProjectActivation(editor);

		const archivedTrack = clipByName(editor, toneA.name).locator('xpath=ancestor::div[@data-track-row]');
		const otherTrack = clipByName(editor, toneB.name).locator('xpath=ancestor::div[@data-track-row]');
		const spectrogram = editor.getByRole('button', { name: 'Spectrogram', exact: true });
		await expect(archivedTrack).toHaveAttribute('data-display-mode', 'waveform');
		await spectrogram.click();
		await expect(archivedTrack).toHaveAttribute('data-display-mode', 'spectrogram');

		await chooseNestedCommandAction(page, editor, 'Window', ['Other waveform']);
		await waitForProjectActivation(editor);
		await expect.soft(otherTrack).toHaveAttribute('data-display-mode', 'waveform');
		await chooseNestedCommandAction(page, editor, 'Window', ['Archived waveform']);
		await waitForProjectActivation(editor);
		await expect(archivedTrack).toHaveAttribute('data-display-mode', 'spectrogram');
		await chooseCommandAction(page, editor, 'Edit', 'Undo');
		await expect.soft(archivedTrack).toHaveAttribute('data-display-mode', 'waveform');
		await expect.soft(spectrogram).toHaveAttribute('aria-pressed', 'false');
		await chooseCommandAction(page, editor, 'Edit', 'Redo');
		await expect(archivedTrack).toHaveAttribute('data-display-mode', 'spectrogram');
		await expect(spectrogram).toHaveAttribute('aria-pressed', 'true');
	} finally {
		await rm(archivePath, { force: true });
		await download.delete();
	}
});

test('Spectral Delete from a reopened project cannot edit a different tab after module loading', async ({ page }, result) => {
	test.setTimeout(45_000);
	let entered = false;
	let release;
	const held = new Promise(resolve => { release = resolve; });
	await page.route(/\/spectral-edit-admission-[^/]+\.js$/u, async route => {
		entered = true;
		await held;
		await route.continue();
	});
	await disableNativeSavePicker(page);
	const editor = await bootEditor(page, '/embed/en/', { showProjectBin: false });
	await renameProject(page, editor, 'Source recording');
	await importFiles(editor, [toneA]);
	const downloading = page.waitForEvent('download');
	await chooseExportProjectFileAction(page, editor);
	const download = await downloading;
	const archivePath = result.outputPath(download.suggestedFilename());
	try {
		await download.saveAs(archivePath);
		await chooseFileAction(page, editor, 'New');
		await waitForProjectActivation(editor);
		await renameProject(page, editor, 'Destination recording');
		await importFiles(editor, [toneB]);
		await selectSpectralBand(page, editor, '500', '800');
		const original = rms(await exportSamples(page, editor));
		expect(original).toBeGreaterThan(0.1);

		const choosing = page.waitForEvent('filechooser');
		await chooseFileAction(page, editor, 'Open');
		await (await choosing).setFiles(archivePath);
		await expect(editor.getByRole('tab', { name: 'Source recording', exact: true })).toHaveAttribute('aria-selected', 'true');
		await waitForProjectActivation(editor);
		await selectSpectralBand(page, editor, '250', '400');
		await chooseNestedCommandAction(page, editor, 'Effect', ['Spectral editing', 'Spectral delete']);
		await expect.poll(() => entered).toBe(true);
		const effectProgress = page.getByRole('progressbar', { name: 'Processing spectral selection locally' });
		await expect(effectProgress).toBeVisible();
		await chooseNestedCommandAction(page, editor, 'Window', ['Destination recording']);
		await waitForProjectActivation(editor);
		await expect(editor.getByRole('slider', { name: 'Spectral selection center-frequency handle', exact: true })).toBeVisible();
		release();
		await expect(effectProgress).toBeHidden({ timeout: 20_000 });
		const current = rms(await exportSamples(page, editor));
		expect(current).toBeCloseTo(original, 6);
	} finally {
		release();
		await rm(archivePath, { force: true });
		await download.delete();
	}
});

function rms(samples) {
	return Math.sqrt(samples.reduce((sum, sample) => sum + sample ** 2, 0) / samples.length);
}

async function selectSpectralBand(page, editor, lower, upper) {
	await editor.getByRole('button', { name: 'Spectrogram', exact: true }).click();
	await chooseCommandAction(page, editor, 'Select', 'Select all');
	await chooseNestedCommandAction(page, editor, 'Effect', ['Spectral editing', 'Spectral box select']);
	const dialog = page.getByRole('dialog', { name: 'Spectral selection', exact: true });
	await dialog.getByRole('textbox', { name: /^Minimum frequency \(Hz\)/u }).fill(lower);
	await dialog.getByRole('textbox', { name: /^Maximum frequency \(Hz\)/u }).fill(upper);
	await dialog.getByRole('button', { name: 'Select range', exact: true }).click();
	await expect(dialog).toBeHidden();
}

test('switching projects restores the playhead and zoom of each tab', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await renameProject(page, editor, 'First edit');
	await importFiles(editor, [toneA]);
	const playhead = editor.getByRole('slider', { name: 'Playhead', exact: true });
	const firstClip = clipByName(editor, toneA.name);
	const originalWidth = (await firstClip.boundingBox()).width;
	await editor.getByRole('button', { name: 'Zoom in', exact: true }).click();
	await expect.poll(async () => (await firstClip.boundingBox()).width).toBeGreaterThan(originalWidth);
	const firstWidth = (await firstClip.boundingBox()).width;
	await playhead.press('ArrowRight');
	await expect.poll(async () => Number(await playhead.getAttribute('aria-valuenow'))).toBeGreaterThan(0);
	const firstFrame = await playhead.getAttribute('aria-valuenow');

	await editor.getByRole('button', { name: 'New project', exact: true }).click();
	await waitForProjectActivation(editor);
	await renameProject(page, editor, 'Second edit');
	await expect(playhead).toHaveAttribute('aria-valuenow', '0');
	await importFiles(editor, [toneA]);
	await expect.poll(async () => (await clipByName(editor, toneA.name).boundingBox()).width).toBeCloseTo(originalWidth, 0);

	await editor.getByRole('tab', { name: 'First edit', exact: true }).click();
	await waitForProjectActivation(editor);
	await expect(playhead).toHaveAttribute('aria-valuenow', firstFrame);
	await expect.poll(async () => (await firstClip.boundingBox()).width).toBeCloseTo(firstWidth, 0);
});

test('keyboard navigation brings a clipped destination project tab into view', async ({ page }) => {
	await page.setViewportSize({ width: 1024, height: 800 });
	const editor = await bootEditor(page, '/embed/en/');
	const titles = ['First', 'Second', 'Third', 'Fourth'].map(ordinal => `${ordinal} recording project with a long title`);
	await renameProject(page, editor, titles[0]);
	for (const title of titles.slice(1)) {
		await editor.getByRole('button', { name: 'New project', exact: true }).click();
		await waitForProjectActivation(editor);
		await renameProject(page, editor, title);
	}
	const tabs = editor.getByRole('navigation', { name: 'Project tabs' });
	const first = tabs.getByRole('tab', { name: titles[0], exact: true });
	const last = tabs.getByRole('tab', { name: titles.at(-1), exact: true });
	await first.click();
	await waitForProjectActivation(editor);
	await expect(last).not.toBeInViewport();
	await page.keyboard.press('End');
	await expect(last).toHaveAttribute('aria-selected', 'true');
	await waitForProjectActivation(editor);
	await expect(last).toBeFocused();
	await expect(last).toBeInViewport({ ratio: 0.75 });
});

test('switching to a clipped project from the Window menu scrolls its tab into view', async ({ page }) => {
	await page.setViewportSize({ width: 1024, height: 800 });
	const editor = await bootEditor(page, '/embed/en/');
	const titles = ['First', 'Second', 'Third', 'Fourth'].map(ordinal => `${ordinal} recording project with a long title`);
	await renameProject(page, editor, titles[0]);
	for (const title of titles.slice(1)) {
		await editor.getByRole('button', { name: 'New project', exact: true }).click();
		await waitForProjectActivation(editor);
		await renameProject(page, editor, title);
	}
	const first = editor.getByRole('tab', { name: titles[0], exact: true });
	const last = editor.getByRole('tab', { name: titles.at(-1), exact: true });
	await first.click();
	await waitForProjectActivation(editor);
	await expect(last).not.toBeInViewport();
	await chooseNestedCommandAction(page, editor, 'Window', [titles.at(-1)]);
	await expect(last).toHaveAttribute('aria-selected', 'true');
	await waitForProjectActivation(editor);
	await expect(last).toBeInViewport({ ratio: 0.75 });
});

test('each open tab retains its own timeline scroll position', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	const recording = { name: 'Long session.wav', mimeType: 'audio/wav',
		buffer: Buffer.from(encodeWav([new Float32Array(48_000 * 20)], { sampleRate: 48_000, bitDepth: 16 })) };
	const timeline = editor.locator('[data-timeline]');
	const position = () => timeline.evaluate(element => element.scrollLeft);
	const scroll = async (left) => {
		await timeline.evaluate((element, requested) => { element.scrollLeft = requested; }, left);
		await expect.poll(position).toBe(left);
	};
	await renameProject(page, editor, 'First timeline');
	await importFiles(editor, [recording]);
	await expect(clipByName(editor, recording.name)).toHaveCount(1);
	await scroll(420);
	await editor.getByRole('button', { name: 'New project', exact: true }).click();
	await waitForProjectActivation(editor);
	await renameProject(page, editor, 'Second timeline');
	await importFiles(editor, [recording]);
	await expect(clipByName(editor, recording.name)).toHaveCount(1);
	await expect.poll(position).toBe(0);
	await scroll(170);
	await editor.getByRole('tab', { name: 'First timeline', exact: true }).click();
	await waitForProjectActivation(editor);
	await expect.poll(position).toBe(420);
	await editor.getByRole('tab', { name: 'Second timeline', exact: true }).click();
	await waitForProjectActivation(editor);
	await expect.poll(position).toBe(170);
});
