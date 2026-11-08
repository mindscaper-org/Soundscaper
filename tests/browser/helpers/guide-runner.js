/* SPDX-License-Identifier: AGPL-3.0-only */

/**
 * Replays a handbook guide against the built editor, one Playwright step per
 * guide step, using the same labels the handbook page tells the reader to use.
 * The step vocabulary lives in `handbook/guides/steps.mjs`; this file is the
 * only place that knows how each kind is driven.
 */

import { expect, test } from '@playwright/test';

import { describeStep } from '../../../handbook/guides/steps.mjs';
import { GUIDE_FIXTURES } from '../../../handbook/guides/fixtures.mjs';
import {
	bootEditor,
	chooseCommandAction,
	chooseDropdown,
	chooseFileAction,
	chooseNestedCommandAction,
	clickClipInterior,
	clipByName,
	closeDialog,
	collectClientErrors,
	commitInput,
	disableNativeSavePicker,
	openExportDialog,
} from '../audio-editor-test-helpers.js';
import {
	runDragClip,
	runExportProject,
	runOpenAudacityProject,
	runOpenProjectFile,
	runRackEffect,
	runResample,
} from './guide-actions.js';
import { guideFixtureClipName, guideFixtureFile } from './guide-fixtures.js';
import { mockFreesoundApi, runFreesoundInsert, runFreesoundSearch } from './guide-freesound.js';
import { runContrast, runMacro, runPlayAtSpeed } from './guide-workflows.js';
import { chooseTrackMenuAction } from './track-menu.js';
import { applyGuideEffectSetting } from './guide-effect-settings.js';
import { runSpectralRange } from './guide-spectral-range.js';
import { verifyNyquistDeliveryDownload, verifyNyquistWorkflowDialog } from './guide-nyquist-delivery-workflows.js';

const EFFECT_TIMEOUT = 30_000;
const EXPORT_TIMEOUT = 60_000;
const APPLIED_STATUS = 'Applied the Audacity effect.';
const NOISE_PROFILE_STATUS = 'Noise profile is ready.';

/** The step sentence without its Markdown, for the Playwright report. */
function plainText(markdown) {
	return markdown.replaceAll('**', '').replaceAll('`', '');
}

function status(editor) {
	return editor.locator('[data-status]');
}

async function expectSuccess(editor, timeout = EFFECT_TIMEOUT) {
	await expect(status(editor)).toHaveAttribute('data-state', 'success', { timeout });
}

/**
 * An imported clip carries its file name; the clip an effect writes back drops
 * the extension, and one that replaces the whole clip is simply "Audio clip".
 * All three are the reader's "the clip", so the named form wins when it exists
 * and the renamed form stands in when it does not.
 */
function guideClip(editor, clipName, index = 0) {
	const base = clipName.replace(/\.wav$/u, '').replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
	const named = editor.getByRole('group', { name: new RegExp(`^${base}(?:\\.wav)? clip(?:,|$)`, 'u') });
	const renamed = editor.getByRole('group', { name: /^Audio clip clip(?:,|$)/u });
	return named.or(renamed).nth(index);
}

async function currentClip(state) {
	if (!state.clipName) throw new Error('This step needs an imported clip.');
	const clip = guideClip(state.editor, state.clipName);
	await expect(clip).toBeVisible();
	const timeline = state.editor.locator('.audio-editor-timeline-scroll');
	const scrollLeft = await timeline.evaluate((element) => element.scrollLeft);
	await clip.scrollIntoViewIfNeeded();
	// Firefox may reveal a lower track by moving the clip start underneath the
	// sticky track headers. Keep the reader's horizontal timeline position.
	await timeline.evaluate((element, left) => { element.scrollLeft = left; }, scrollLeft);
	const box = await clip.boundingBox();
	expect(box).not.toBeNull();
	return { clip, box };
}

async function selectionSeconds(editor, edge) {
	const text = await editor.getByRole('group', { name: `Selection ${edge}`, exact: true })
		.locator('.timecode__display').textContent();
	const digits = text.replace(/\s/gu, '').match(/(\d+)h(\d+)m(\d+(?:\.\d+)?)s/u);
	expect(digits).not.toBeNull();
	return Number(digits[1]) * 3600 + Number(digits[2]) * 60 + Number(digits[3]);
}

async function revealRulerBehindContrast(page, viewport) {
	const dialog = page.getByRole('dialog', { name: 'Contrast', exact: true });
	if (!await dialog.isVisible()) return;
	const [panel, header, ruler] = await Promise.all([
		dialog.boundingBox(), dialog.locator('.dialog-header').boundingBox(), viewport.boundingBox(),
	]);
	expect(panel).not.toBeNull(); expect(header).not.toBeNull(); expect(ruler).not.toBeNull();
	if (panel.x >= ruler.x + ruler.width || panel.x + panel.width <= ruler.x
		|| panel.y >= ruler.y + ruler.height || panel.y + panel.height <= ruler.y) return;
	// Contrast stays open while its next passage is selected. Move its modeless
	// window through the real title bar instead of pressing through the window.
	const x = header.x + header.width / 2, y = header.y + header.height / 2;
	await page.mouse.move(x, y);
	await page.mouse.down();
	await page.mouse.move(x, y + ruler.y + ruler.height + 8 - panel.y, { steps: 5 });
	await page.mouse.up();
}

// A drag in the ruler above the tracks makes a time selection; the ruler is
// also where the playhead handle sits, and pressing on the handle drags the
// playhead instead. The playhead rests at the clip start, so a selection that
// begins there is dragged from its far end back to the start.
async function dragSelection(page, state, from, to) {
	const { clip } = await currentClip(state);
	const interior = from > 0 && from < 1 && to > 0 && to < 1;
	// Accessible timing describes the logical clip even when its painted projection is clipped.
	const timing = (await clip.getAttribute('aria-label'))
		.match(/ clip, starts at ([\d.]+) seconds?, ([\d.]+) seconds? long$/u);
	expect(timing).not.toBeNull();
	const start = Number(timing[1]);
	const duration = Number(timing[2]);
	const viewport = state.editor.locator('[data-ruler-interaction]').first();
	const ruler = viewport.locator('canvas.timeline-ruler');
	await expect(ruler).toBeVisible();
	await revealRulerBehindContrast(page, viewport);
	let rulerBox;
	let viewportBox;
	let coordinate;
	let y;
	let previousGeometry;
	const x = (fraction) => viewportBox.x + coordinate.contentOffset
		+ (start + duration * fraction) * coordinate.pixelsPerSecond - coordinate.contentScrollX
		+ (fraction === 0 ? 2 : fraction === 1 ? -2 : 0);
	// Use the ruler's actual scale and live scroll, independently of clip projection.
	// Recenter until both logical endpoints settle in the visible ruler.
	await expect.poll(async () => {
		[rulerBox, viewportBox, coordinate] = await Promise.all([
			ruler.boundingBox(), viewport.boundingBox(), viewport.evaluate((element) => {
				const timeline = element.closest('[data-timeline]');
				const scrollScale = Number(timeline.dataset.timelineScrollScale);
				return { pixelsPerSecond: Number(element.dataset.rulerPixelsPerSecond),
					contentOffset: Number(element.dataset.rulerContentOffset), scrollScale,
					contentScrollX: timeline.scrollLeft * scrollScale };
			}),
		]);
		expect(rulerBox).not.toBeNull();
		expect(viewportBox).not.toBeNull();
		expect(Number.isFinite(coordinate.pixelsPerSecond) && coordinate.pixelsPerSecond > 0).toBe(true);
		expect(Number.isFinite(coordinate.contentOffset)).toBe(true);
		expect(Number.isFinite(coordinate.scrollScale) && coordinate.scrollScale > 0).toBe(true);
		const left = Math.max(rulerBox.x, viewportBox.x);
		const right = Math.min(rulerBox.x + rulerBox.width, viewportBox.x + viewportBox.width);
		// The 40 px canvas can be clipped by its 33 px owner. Stay inside the
		// visible lower half; the upper half belongs to loop-region gestures.
		const top = Math.max(rulerBox.y + rulerBox.height / 2, viewportBox.y);
		const bottom = Math.min(rulerBox.y + rulerBox.height, viewportBox.y + viewportBox.height);
		if (right - left < 4 || bottom - top < 4) return false;
		y = (top + bottom) / 2;
		if (Math.min(x(from), x(to)) < left + 1 || Math.max(x(from), x(to)) > right - 1) {
			const rangeCenter = (x(from) + x(to)) / 2;
			const rulerCenter = (left + right) / 2;
			await state.editor.locator('.audio-editor-timeline-scroll').evaluate((element, delta) => {
				element.scrollLeft += delta;
			}, (rangeCenter - rulerCenter) / coordinate.scrollScale);
			previousGeometry = undefined;
			return false;
		}
		// A reversed drag can finish on the playhead; only its press needs to hit the ruler.
		const receivesPointer = await viewport.evaluate((element, point) => (
			element.ownerDocument.elementFromPoint(point.x, point.y)?.closest('[data-ruler-interaction]') === element
		), { x: x(from === 0 ? to : from), y });
		if (!receivesPointer) { previousGeometry = undefined; return false; }
		const geometry = JSON.stringify([rulerBox, viewportBox, coordinate]);
		const settled = geometry === previousGeometry;
		previousGeometry = geometry;
		return settled;
	}, { message: 'Selection drag endpoints settle inside the visible ruler.' }).toBe(true);
	const [startX, endX] = from === 0 ? [x(to), x(from)] : [x(from), x(to)];
	await page.mouse.move(startX, y);
	await page.mouse.down();
	await page.mouse.move(endX, y, { steps: 8 });
	await page.mouse.up();
	await expect(state.editor.locator('[data-time-selection-overlay]').first()).toBeVisible();
	if (interior) {
		// Observe committed controls, not the pointer preview. A clipped projection
		// must not silently redefine the guide's requested logical passage.
		await expect.poll(() => selectionSeconds(state.editor, 'start')).toBeCloseTo(start + duration * Math.min(from, to), 2);
		await expect.poll(() => selectionSeconds(state.editor, 'end')).toBeCloseTo(start + duration * Math.max(from, to), 2);
	}
}

async function openEffectDialog(page, state, group, name) {
	await chooseNestedCommandAction(page, state.editor, 'Effect', [group, name]);
	const dialog = page.getByRole('dialog', { name: 'Apply effect', exact: true });
	await expect(dialog).toBeVisible();
	return dialog;
}

async function runEffect(page, state, entry) {
	if (entry.direct) {
		await chooseNestedCommandAction(page, state.editor, 'Effect', [entry.group, entry.name]);
		await expect(status(state.editor)).toHaveText(APPLIED_STATUS, { timeout: EFFECT_TIMEOUT });
		return;
	}
	const dialog = await openEffectDialog(page, state, entry.group, entry.name);
	for (const setting of entry.settings) await applyGuideEffectSetting(page, dialog, setting);
	await dialog.getByRole('button', { name: 'Apply to selection', exact: true }).click();
	await expect(dialog).toBeHidden({ timeout: EFFECT_TIMEOUT });
	await expectSuccess(state.editor);
}

async function runNoiseProfile(page, state) {
	const dialog = await openEffectDialog(page, state, 'Noise removal and repair', 'Noise Reduction');
	await dialog.getByRole('button', { name: 'Get noise profile', exact: true }).click();
	await expect(status(state.editor)).toHaveText(NOISE_PROFILE_STATUS, { timeout: EFFECT_TIMEOUT });
	await closeDialog(dialog);
}

async function runExport(page, state, entry) {
	const dialog = await openExportDialog(page, state.editor);
	await chooseDropdown(page, dialog.locator('[data-export-field="format"]'), entry.format);
	if (entry.mode) await chooseDropdown(page, dialog.locator('[data-export-field="output"]'), entry.mode);
	await dialog.getByRole('button', { name: 'Export', exact: true }).click();
	const download = dialog.locator('[data-export-download]');
	const failure = dialog.locator('.audio-editor-field-error');
	await expect(download.or(failure)).toBeVisible({ timeout: EXPORT_TIMEOUT });
	expect(await failure.allTextContents()).toEqual([]);
	await expect(download).toHaveAttribute('download', new RegExp(`\\.${entry.extension}$`, 'u'));
	await verifyNyquistDeliveryDownload(page, download, entry);
	await closeDialog(dialog);
}

async function runPlay(state) {
	const { editor } = state;
	await editor.getByRole('button', { name: 'Play', exact: true }).click();
	const stop = editor.getByRole('button', { name: 'Stop', exact: true });
	await expect(stop).toBeEnabled();
	await stop.click();
}

async function runGenerate(page, state, entry) {
	await chooseCommandAction(page, state.editor, 'Generate', entry.name);
	const dialog = page.getByRole('dialog', { name: entry.name, exact: true });
	await expect(dialog).toBeVisible();
	for (const field of entry.fields) {
		await commitInput(dialog.locator(`[data-generator-field="${field.field}"] input`), field.value);
	}
	await dialog.getByRole('button', { name: 'Generate', exact: true }).click();
	await expect(dialog).toBeHidden({ timeout: EFFECT_TIMEOUT });
}

async function runMixRender(page, state, entry) {
	await chooseCommandAction(page, state.editor, 'Tracks', 'Mix & Render');
	const dialog = page.getByRole('dialog', { name: 'Mix & Render', exact: true });
	await expect(dialog).toBeVisible();
	for (const label of ['Mix down', 'Render effects', 'Replace originals']) {
		await expect(dialog.getByRole('checkbox', { name: label, exact: true })).toBeChecked();
	}
	if (!entry.replaceOriginals) await dialog.getByRole('checkbox', { name: 'Replace originals', exact: true }).setChecked(false);
	await chooseDropdown(page, dialog.getByRole('group', { name: 'Mix down to', exact: true }), 'Stereo');
	await dialog.getByRole('button', { name: 'Mix & Render', exact: true }).click();
	await expect(dialog).toBeHidden({ timeout: EFFECT_TIMEOUT });
}

async function runMarker(page, state, entry) {
	const { editor } = state;
	// The Panels entry toggles, so a second marker in the same guide must not
	// close the panel the first one opened.
	const panel = editor.getByRole('region', { name: 'Markers and named regions', exact: true });
	if (!await panel.isVisible()) await chooseNestedCommandAction(page, editor, 'Window', ['Markers']);
	await expect(panel).toBeVisible();
	await panel.getByRole('button', { name: 'Add marker at playhead', exact: true }).click();
	// Complete the panel's scheduled creation focus before moving to the ruler.
	await expect(panel.getByRole('button', { name: /^Unnamed annotation, Marker, / }).first()).toBeFocused();
	// A new marker is the one still called "Unnamed annotation"; earlier markers
	// keep the names the guide gave them, wherever on the timeline they sit.
	const layer = editor.getByRole('listbox', { name: 'Markers and named regions', exact: true });
	const marker = layer.getByRole('option', { name: /^Unnamed annotation, / }).first();
	await expect(marker).toBeVisible();
	await marker.focus();
	await marker.press('Enter');
	const rename = editor.locator('.audio-editor-timeline-annotation__rename--overlay');
	await expect(rename).toBeFocused();
	await rename.fill(entry.name);
	await rename.press('Enter');
	// The marker locator matched by its unnamed label, so look the renamed one up afresh.
	await expect(layer.getByRole('option', { name: new RegExp(`^${entry.name}, Marker`, 'u') })).toHaveCount(1);
}

async function runNyquist(page, state, entry) {
	await chooseNestedCommandAction(page, state.editor, entry.menu, ['Nyquist', entry.name]);
	const dialog = page.getByRole('dialog', { name: entry.name, exact: true });
	await expect(dialog).toBeVisible();
	for (const field of entry.fields) {
		const label = field.label.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
		await commitInput(dialog.getByRole('spinbutton', { name: new RegExp(`^${label}(?: — .+)?$`, 'u') }), field.value);
	}
	await dialog.getByRole('button', { name: 'Apply', exact: true }).click();
	if (entry.menu === 'Analyze') {
		// An analyzer keeps its dialog open to report what it found.
		await expect(dialog).toContainText('Nyquist output', { timeout: EFFECT_TIMEOUT });
		await verifyNyquistWorkflowDialog(dialog, entry);
		await closeDialog(dialog);
		return;
	}
	await expect(dialog).toBeHidden({ timeout: EFFECT_TIMEOUT });
	await expectSuccess(state.editor);
}

async function runCheck(state, entry) {
	const { editor } = state;
	if (entry.startsAt !== null) {
		const clip = guideClip(editor, guideFixtureClipName(entry.startsAt.fixture));
		await expect(clip).toHaveAttribute('aria-label', new RegExp(`starts at ${String(entry.startsAt.seconds).replaceAll('.', '\\.')} seconds?,`, 'u'), { timeout: EFFECT_TIMEOUT });
	}
	if (entry.clips !== null) await expect(editor).toHaveAttribute('data-clip-count', String(entry.clips), { timeout: EFFECT_TIMEOUT });
	if (entry.tracks !== null) await expect(editor).toHaveAttribute('data-track-count', String(entry.tracks), { timeout: EFFECT_TIMEOUT });
	if (entry.clip !== null) await expect(clipByName(editor, entry.clip)).toBeVisible({ timeout: EFFECT_TIMEOUT });
	if (entry.moved !== null) {
		await expect(guideClip(editor, guideFixtureClipName(entry.moved))).not.toHaveAttribute('aria-label', /starts at 0 seconds/u);
	}
	if (entry.track !== null) {
		await expect(editor.locator('.track-control-panel__track-name-text').filter({ hasText: entry.track }).first()).toBeVisible();
	}
	if (entry.loop !== null) {
		await expect(editor.getByRole('button', { name: 'Loop selection', exact: true })).toHaveAttribute('aria-pressed', String(entry.loop));
	}
	if (entry.muted !== null) {
		// A fresh project starts with an empty track of its own, so the check is
		// about every Mute button the project has rather than a fixed count.
		const buttons = editor.locator('[data-track-row]').getByRole('button', { name: 'Mute', exact: true });
		const pressed = editor.locator('[data-track-row]').getByRole('button', { name: 'Mute', exact: true, pressed: true });
		await expect(pressed).toHaveCount(entry.muted === 'all' ? await buttons.count() : 0);
	}
	if (entry.panel !== null) await expect(editor.locator(`[data-workspace-panel="${entry.panel.id}"]`)).toBeVisible();
}

async function executeStep(page, state, entry) {
	switch (entry.kind) {
		case 'open':
			state.editor = await bootEditor(page, '/embed/en/');
			return;
		case 'import':
			{
				const clipName = guideFixtureClipName(entry.fixture);
				const [chooser] = await Promise.all([
					page.waitForEvent('filechooser'),
					chooseFileAction(page, state.editor, 'Import'),
				]);
				await chooser.setFiles(guideFixtureFile(entry.fixture));
				const clip = guideClip(state.editor, clipName);
				await expectSuccess(state.editor);
				await expect(clip).toBeVisible({ timeout: EFFECT_TIMEOUT });
				state.clipName = clipName;
			}
			state.fixture = entry.fixture;
			return;
		case 'menu': {
			// Zoom is applied by the editor after the menu dismisses. The next
			// guide step measures clip geometry, so wait for that view update.
			const zoomClip = entry.path.join('/') === 'View/Zoom/Zoom in' && state.clipName
				? guideClip(state.editor, state.clipName) : null;
			const zoomWidth = zoomClip ? await zoomClip.evaluate((element) => element.getBoundingClientRect().width) : 0;
			if (entry.path.length === 2) await chooseCommandAction(page, state.editor, entry.path[0], entry.path[1]);
			else await chooseNestedCommandAction(page, state.editor, entry.path[0], entry.path.slice(1));
			if (zoomClip) await expect.poll(() => zoomClip.evaluate((element) => element.getBoundingClientRect().width))
				.toBeGreaterThan(zoomWidth);
			return;
		}
		case 'freesound-search':
			await runFreesoundSearch(state, entry);
			return;
		case 'freesound-insert':
			await runFreesoundInsert(state, entry);
			return;
		case 'mix-render':
			await runMixRender(page, state, entry);
			return;
		case 'contrast':
			await runContrast(page, state, entry);
			return;
		case 'macro':
			await runMacro(page, state, entry);
			return;
		case 'play-at-speed':
			await runPlayAtSpeed(page, state, entry);
			return;
		case 'select-range':
			await dragSelection(page, state, entry.from, entry.to);
			return;
		case 'cursor': {
			const { clip } = await currentClip(state);
			await clickClipInterior(page, clip, entry.fraction);
			return;
		}
		case 'select-clips':
			for (const [index, fixture] of entry.fixtures.entries()) {
				// A split leaves several pieces with the same source name. Repeating
				// its fixture selects the next piece, rather than toggling the first.
				const piece = entry.fixtures.slice(0, index).filter((id) => id === fixture).length;
				const clip = guideClip(state.editor, guideFixtureClipName(fixture), piece);
				if (entry.keyboard) await clip.press(index === 0 ? 'Enter' : 'Shift+Enter');
				else await clip.locator('.clip-header').click({ modifiers: index === 0 ? [] : ['Shift'] });
			}
			return;
		case 'editing-preference': {
			await chooseCommandAction(page, state.editor, 'Edit', 'Preferences');
			const dialog = page.getByRole('dialog', { name: 'Editor preferences', exact: true });
			await dialog.getByRole('tab', { name: /Editing$/u }).click();
			await dialog.getByRole('checkbox', { name: entry.label, exact: true }).setChecked(entry.checked);
			await dialog.getByRole('button', { name: 'Close', exact: true }).last().click();
			await expect(dialog).toBeHidden();
			return;
		}
		case 'tool':
			await state.editor.getByRole('button', { name: entry.name, exact: true }).click();
			return;
		case 'effect':
			await runEffect(page, state, entry);
			return;
		case 'spectral-range':
			await runSpectralRange(page, state.editor, entry);
			return;
		case 'noise-profile':
			await runNoiseProfile(page, state);
			return;
		case 'nyquist':
			await runNyquist(page, state, entry);
			return;
		case 'analyze':
			await chooseCommandAction(page, state.editor, 'Analyze', entry.name);
			await expect(page.getByRole('dialog', { name: entry.dialog, exact: true }))
				.toBeVisible({ timeout: EFFECT_TIMEOUT });
			return;
		case 'save':
			await chooseCommandAction(page, state.editor, 'File', 'Save project');
			await expect(state.editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved', { timeout: EFFECT_TIMEOUT });
			return;
		case 'track-button': {
			const button = state.editor.locator('[data-track-row]').last().getByRole('button', { name: entry.name, exact: true });
			await button.click();
			await expect(button).toHaveAttribute('aria-pressed', 'true');
			return;
		}
		case 'add-track':
			await state.editor.getByRole('button', { name: 'Add track', exact: true }).click();
			await page.getByRole('menuitem', { name: entry.type, exact: true }).click();
			return;
		case 'export':
			await runExport(page, state, entry);
			return;
		case 'track-menu': {
			const row = entry.fixture
				? guideClip(state.editor, guideFixtureClipName(entry.fixture)).locator('xpath=ancestor::div[@data-track-row][1]')
				: state.editor.locator('[data-track-row]').last();
			await chooseTrackMenuAction(page, state.editor, row, entry.path);
			await expectSuccess(state.editor);
			return;
		}
		case 'play':
			await runPlay(state);
			return;
		case 'generate':
			await runGenerate(page, state, entry);
			return;
		case 'marker':
			await runMarker(page, state, entry);
			return;
		case 'check':
			await runCheck(state, entry);
			return;
		case 'rack-effect':
			await runRackEffect(page, state, entry);
			return;
		case 'open-audacity-project':
			await runOpenAudacityProject(page, state);
			return;
		case 'export-project':
			await runExportProject(page, state);
			return;
		case 'open-project-file':
			await runOpenProjectFile(page, state);
			return;
		case 'resample':
			await runResample(page, state, entry, (await currentClip(state)).clip);
			return;
		case 'drag-clip':
			await runDragClip(page, state, entry, (await currentClip(state)).clip, state.fixture);
			return;
		case 'note':
			return;
		default:
			throw new RangeError(`Unknown guide step kind ${String(entry.kind)}.`);
	}
}

/** Replay every step of a guide and fail on any client error along the way. */
export async function runGuide(page, guide) {
	await disableNativeSavePicker(page);
	const errors = collectClientErrors(page);
	const state = { editor: null, clipName: null, fixture: null, projectFile: null };
	if (guide.steps.some((entry) => entry.kind === 'freesound-search' || entry.kind === 'freesound-insert')) {
		state.freesoundRequests = await mockFreesoundApi(page);
	}
	for (const [index, entry] of guide.steps.entries()) {
		// Step titles name the example and the exact stretch, the way a tutorial does,
		// so a failing report says what the suite actually did.
		const title = `${String(index + 1)}. ${plainText(describeStep(entry, { fixture: (id) => GUIDE_FIXTURES[id], facet: 'tutorial' }))}`;
		await test.step(title, () => executeStep(page, state, entry));
	}
	expect(errors).toEqual([]);
}
