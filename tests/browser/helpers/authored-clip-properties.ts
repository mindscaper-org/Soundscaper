/* SPDX-License-Identifier: AGPL-3.0-only */

import type { Locator, Page } from '@playwright/test';
import { editorDatabaseName } from './editor-databases.js';

type Data = Readonly<Record<string, unknown>>;
type ProjectReader = (page: Page, projectId: string, databaseName: string) => Promise<unknown>;
export interface ClipPropertyClock {
	readonly upstreamNumber: boolean;
	readonly projectSampleRate?: number;
	readonly sourceSampleRate?: number;
	readonly pitchPercent?: boolean;
}

const PROJECT_FRAMES = new Set(['startFrame', 'durationFrame', 'fadeInFrame', 'fadeOutFrame', 'fadeInFrames', 'fadeOutFrames']);
const SOURCE_FRAMES = new Set(['sourceInFrame', 'sourceStartFrame']);
const STORED_FIELDS: Readonly<Record<string, string>> = Object.freeze({
	startFrame: 'timelineStartFrame', durationFrame: 'durationFrames',
	sourceInFrame: 'sourceStartFrame', sourceStartFrame: 'sourceStartFrame',
	fadeInFrame: 'fadeInFrames', fadeOutFrame: 'fadeOutFrames',
	fadeInFrames: 'fadeInFrames', fadeOutFrames: 'fadeOutFrames',
	pitchCents: 'pitchCents', speedRatio: 'speedRatio',
});

/** Caller frame and cents units stay stable across numeric and native inspectors. */
export function authoredClipPropertyInput(field: string, value: unknown, clock: ClipPropertyClock): unknown {
	if (field === 'pitchCents') return clock.pitchPercent
		? 100 * (2 ** (finite(value) / 1_200) - 1) : finite(value) / 100;
	if (!clock.upstreamNumber) return value;
	if (PROJECT_FRAMES.has(field)) return finite(value) / rate(clock.projectSampleRate);
	if (SOURCE_FRAMES.has(field)) return finite(value) / rate(clock.sourceSampleRate);
	if (field === 'speedRatio') return finite(value) * 100;
	return value;
}

export async function editAuthoredClipProperties(page: Page, editor: Locator, clip: Locator,
	edits: Readonly<Record<string, unknown>>, readProject: ProjectReader): Promise<void> {
	const { expect } = await import('@playwright/test');
	const { clipField, closeClipProperties, commitInput, openClipProperties } = await import('../audio-editor-test-helpers.js');
	const { setClipGain } = await import('../audio-editor-clip-settings-test-helpers.js');
	const dialog = await openClipProperties(page, editor, clip);
	const clipId = await requestedClipId(clip, dialog);
	await expect(dialog.locator('[data-selection]'), 'This helper authors one clip, not an upstream multi-selection.').toHaveCount(0);
	for (const [field, value] of Object.entries(edits)) {
		if (value === undefined) continue;
		if (field === 'stretchToTempo') {
			const inline = dialog.locator('[data-clip-properties-field="stretch-tempo"]');
			const numeric = await inline.count() > 0;
			const toggle = numeric ? inline : dialog.locator('[data-clip-field="stretchToTempo"]').getByRole('checkbox');
			await revealOwningDrawer(toggle);
			const checked = numeric ? await toggle.getAttribute('aria-checked') === 'true' : await toggle.isChecked();
			if (checked !== Boolean(value)) await toggle.click();
			if (numeric) await expect(toggle).toHaveAttribute('aria-checked', String(Boolean(value)));
			else if (value) await expect(toggle).toBeChecked();
			else await expect(toggle).not.toBeChecked();
			continue;
		}
		if (field === 'gain') { await setClipGain(dialog, value); continue; }
		const input = clipField(dialog, field);
		await revealOwningDrawer(input);
		const upstreamNumber = await isUpstreamNumber(input);
		const needsSnapshot = upstreamNumber || field === 'pitchCents';
		if (needsSnapshot) await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');
		const captured = needsSnapshot ? await snapshot(page, editor, clipId, readProject) : null;
		let pitchPercent = false;
		if (field === 'pitchCents') {
			const inline = dialog.locator('button[data-clip-pitch-unit]');
			const percent = await inline.count() ? inline
				: dialog.locator('[data-clip-pitch-unit]').getByRole('button', { name: 'Percent change', exact: true });
			const pressed = await percent.getAttribute('aria-pressed');
			if (pressed !== 'true' && pressed !== 'false') throw new Error('The pitch control has no selected unit.');
			pitchPercent = pressed === 'true';
		}
		const displayValue = authoredClipPropertyInput(field, value, {
			upstreamNumber, projectSampleRate: captured?.projectRate,
			sourceSampleRate: captured?.sourceRate, pitchPercent,
		});
		await commitInput(input, String(displayValue));
		if (captured && STORED_FIELDS[field]) {
			await expect.poll(async () => storedValue(await snapshot(page, editor, clipId, readProject), field))
				.toBe(expectedStoredValue(captured, field, value));
		}
		// The unfocused upstream NumberField rounds to three decimals; focus
		// restores authored precision without creating another history command.
		await input.focus();
		const expectedDisplay = field === 'pitchCents' && !upstreamNumber
			? Number(Number(displayValue).toFixed(pitchPercent ? 3 : 2)) : displayValue;
		if (Number.isFinite(Number(value))) {
			await expect.poll(async () => Number(await input.inputValue())).toBeCloseTo(Number(expectedDisplay), 6);
		} else await expect(input).toHaveValue(String(value));
		await input.blur();
	}
	await closeClipProperties(dialog);
}

export async function readAuthoredClipDuration(page: Page, editor: Locator, clip: Locator,
	readProject: ProjectReader): Promise<number> {
	const { expect } = await import('@playwright/test');
	const { clipField, closeClipProperties, openClipProperties } = await import('../audio-editor-test-helpers.js');
	const dialog = await openClipProperties(page, editor, clip);
	const input = clipField(dialog, 'durationFrame');
	await revealOwningDrawer(input);
	const clipId = await requestedClipId(clip, dialog);
	await expect(dialog.locator('[data-selection]'), 'This helper authors one clip, not an upstream multi-selection.').toHaveCount(0);
	let frames: number;
	if (await isUpstreamNumber(input)) {
		await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');
		const current = await snapshot(page, editor, clipId, readProject);
		frames = positiveFrames(current.duration);
		await input.focus();
		await expect(input).toHaveValue(String(frames / current.projectRate));
		await input.blur();
	} else frames = positiveFrames(Number(await input.inputValue()));
	await closeClipProperties(dialog);
	return frames;
}

async function requestedClipId(clip: Locator, dialog: Locator): Promise<string> {
	const { expect } = await import('@playwright/test');
	const id = await clip.getAttribute('data-clip-id');
	if (!id) throw new Error('An authored property edit requires the passed clip identity.');
	await expect(dialog.locator('[data-clip-properties-active-clip]')).toHaveAttribute('data-clip-properties-active-clip', id);
	return id;
}

async function revealOwningDrawer(control: Locator): Promise<void> {
	const drawer = control.locator('xpath=ancestor::details[1]');
	if (await drawer.count() && await drawer.getAttribute('open') === null) await drawer.locator(':scope > summary').click();
}

function isUpstreamNumber(input: Locator): Promise<boolean> {
	return input.evaluate(element => element.closest('[data-clip-properties-field].clip-properties__field--number') !== null);
}

interface Snapshot { readonly clip: Data; readonly duration: unknown; readonly projectRate: number; readonly sourceRate: number }
async function snapshot(page: Page, editor: Locator, clipId: string, readProject: ProjectReader): Promise<Snapshot> {
	const projectId = await editor.getAttribute('data-project-id');
	if (!projectId) throw new Error('An authored property edit requires its project identity.');
	const database = editorDatabaseName(await editor.getAttribute('data-product'));
	const project = data(await readProject(page, projectId, database));
	if (project.id !== projectId) throw new Error('The persisted authored project identity changed.');
	const clip = records(project.clips).find(candidate => candidate.id === clipId);
	if (!clip) throw new Error('The persisted authored clip is absent.');
	const source = records(project.sources).find(candidate => candidate.id === clip.sourceId);
	if (!source) throw new Error('The persisted authored source is absent.');
	return { clip, duration: clip.durationFrames,
		projectRate: rate(project.sampleRate), sourceRate: rate(source.sampleRate) };
}

function expectedStoredValue(current: Snapshot, field: string, value: unknown): number {
	if (field === 'pitchCents' && current.clip.linkPitchAndTempo === true) return 2 ** (finite(value) / 1_200);
	return finite(value);
}

function storedValue(current: Snapshot, field: string): unknown {
	if (field === 'durationFrame') return current.duration;
	if (field === 'pitchCents' && current.clip.linkPitchAndTempo === true) return current.clip.speedRatio;
	const result = current.clip[STORED_FIELDS[field]!];
	// Only the optional fade value can be omitted on an existing, validated clip.
	return (field === 'fadeInFrame' || field === 'fadeOutFrame' || field === 'fadeInFrames' || field === 'fadeOutFrames')
		&& result === undefined ? 0 : result;
}

function data(value: unknown): Data {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Expected a persisted authored record.');
	return value as Data;
}
function records(value: unknown): readonly Data[] {
	if (!Array.isArray(value)) throw new TypeError('Expected persisted authored records.');
	return value.map(data);
}
function finite(value: unknown): number {
	const result = Number(value);
	if (!Number.isFinite(result)) throw new TypeError('An authored property requires a finite value.');
	return result;
}
function rate(value: unknown): number {
	if (!Number.isSafeInteger(value) || Number(value) <= 0) throw new TypeError('An authored property requires its actual sample rate.');
	return Number(value);
}
function positiveFrames(value: unknown): number {
	if (!Number.isSafeInteger(value) || Number(value) < 1) throw new TypeError('The authored duration must retain positive integer frames.');
	return Number(value);
}
