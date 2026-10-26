/* SPDX-License-Identifier: AGPL-3.0-only */

import { expect } from '@playwright/test';

export async function openClipMediaSettings(properties) {
	// Linked audio/video selections retain the native media drawer so their
	// picture fields and link stay owned by the existing inspector adapter.
	const drawer = properties.locator('[data-clip-properties-drawer="media"]');
	if (await drawer.count()) {
		if (await drawer.getAttribute('open') === null) await drawer.locator('summary').click();
		await expect(drawer).toHaveAttribute('open', '');
		return drawer;
	}
	await properties.getByRole('button', { name: 'Media settings', exact: true }).click();
	const menu = properties.page().getByRole('menu', { name: 'Media settings', exact: true });
	await expect(menu).toBeVisible();
	return menu;
}

export async function chooseClipMediaSetting(properties, label) {
	const direct = inlineClipMediaSetting(properties, label);
	if (direct && await direct.count()) { await direct.click(); return; }
	const menu = await openClipMediaSettings(properties);
	if (await menu.getAttribute('data-clip-properties-drawer') === 'media') {
		await menu.getByRole('button', { name: label, exact: true }).click();
		return;
	}
	await menu.getByRole('menuitem', { name: label, exact: true })
		.or(menu.getByRole('menuitemcheckbox', { name: label, exact: true })).click();
	await expect(menu).toBeHidden();
}

export async function chooseClipPitchUnit(properties, label) {
	const toggle = properties.locator('[data-clip-pitch-unit]');
	if (await toggle.count()) {
		if (await toggle.getAttribute('aria-pressed') !== String(label === 'Percent change')) await toggle.click();
		await expect(toggle).toHaveAttribute('aria-pressed', String(label === 'Percent change'));
		return;
	}
	const menu = await openClipMediaSettings(properties);
	const units = menu.getByRole('menuitem', { name: /^Pitch unit(?:\s|$)/u });
	await units.focus();
	await units.press('ArrowRight');
	await menu.getByRole('menuitemradio', { name: label, exact: true }).click();
	await expect(menu).toBeHidden();
}

export async function expectClipMediaSettingChecked(properties, label, checked) {
	const direct = inlineClipMediaSetting(properties, label);
	if (direct && await direct.count()) {
		if (await direct.getAttribute('type') === 'checkbox') {
			if (checked) await expect(direct).toBeChecked(); else await expect(direct).not.toBeChecked();
		} else await expect(direct).toHaveAttribute('aria-checked', String(checked));
		return;
	}
	const menu = await openClipMediaSettings(properties);
	await expect(menu.getByRole('menuitemcheckbox', { name: label, exact: true })).toHaveAttribute('aria-checked', String(checked));
	await closeClipMediaSettings(menu);
}

export async function expectClipSampleRate(properties, rate) {
	const input = properties.locator('[data-clip-properties-field="format-rate"] input');
	if (await input.count()) {
		await expect(properties.locator('[data-clip-source-sample-rate]')).toHaveAttribute('data-clip-source-sample-rate', String(rate), { timeout: 60_000 });
		await expect(input).toHaveValue(String(rate)); return;
	}
	const menu = await openClipMediaSettings(properties);
	if (await menu.getAttribute('data-clip-properties-drawer') === 'media') {
		const fact = menu.locator('[data-clip-source-fact="sampleRate"]');
		await expect(fact.locator('.audio-editor-field__value')).toHaveText(String(rate));
		await expect(fact.locator('input')).toHaveCount(0);
		await closeClipMediaSettings(menu);
		return;
	}
	const fact = menu.getByRole('menuitem', { name: new RegExp(`^Sample rate \\(Hz\\):\\s*${rate}$`, 'u') });
	await expect(fact).toBeVisible();
	await expect(fact).toBeDisabled();
	await closeClipMediaSettings(menu);
}

export async function readClipSampleRate(properties) {
	const input = properties.locator('[data-clip-properties-field="format-rate"] input');
	if (await input.count()) return Number(await properties.locator('[data-clip-source-sample-rate]').getAttribute('data-clip-source-sample-rate'));
	const menu = await openClipMediaSettings(properties);
	if (await menu.getAttribute('data-clip-properties-drawer') === 'media') {
		const fact = menu.locator('[data-clip-source-fact="sampleRate"] .audio-editor-field__value');
		await expect(fact).toBeVisible();
		const rate = Number(await fact.innerText());
		await closeClipMediaSettings(menu);
		return rate;
	}
	const fact = menu.getByRole('menuitem', { name: /^Sample rate \(Hz\):/u });
	await expect(fact).toBeDisabled();
	const match = (await fact.innerText()).match(/:\s*(\d+)$/u);
	expect(match).toBeTruthy();
	const rate = Number(match[1]);
	await closeClipMediaSettings(menu);
	return rate;
}

/** Format edits stay drafts until the conversion is requested explicitly. */
export async function resampleClipFormat(properties, sampleRate, sampleFormat) {
	const input = properties.locator('[data-clip-properties-field="format-rate"] input');
	await input.fill(String(sampleRate));
	if (sampleFormat) await properties.locator('[data-clip-properties-field="format-depth"] select').selectOption(sampleFormat);
	await properties.getByRole('button', { name: 'Resample', exact: true }).click();
	await expectClipSampleRate(properties, sampleRate);
}

function inlineClipMediaSetting(properties, label) {
	const selectors = {
		'Invert': '[data-clip-properties-field="invert"]',
		'Optimize for voice / preserve formants': '[data-clip-properties-field="voice"] input',
		'Stretch with project tempo changes': '[data-clip-properties-field="stretch-tempo"]',
		'Render pitch and speed': '[data-clip-properties-action="render-pitch-speed"]',
		'Normalize to −1 dBFS': '[data-clip-properties-action="normalize-peak"]',
		'Normalize to −14 LUFS': '[data-clip-properties-action="normalize-loudness"]',
	};
	return selectors[label] ? properties.locator(selectors[label]) : null;
}

async function closeClipMediaSettings(menu) {
	if (await menu.getAttribute('data-clip-properties-drawer') === 'media') {
		await menu.locator('summary').click();
		await expect(menu).not.toHaveAttribute('open');
		return;
	}
	await menu.press('Escape');
	await expect(menu).toBeHidden();
}

export async function openClipGainDialog(properties) {
	await chooseClipMediaSetting(properties, 'Clip gain (dB)');
	const dialog = properties.page().getByRole('dialog', { name: 'Clip gain (dB)', exact: true });
	await expect(dialog).toBeVisible();
	return dialog;
}

export async function setClipGain(properties, db) {
	const dialog = await openClipGainDialog(properties);
	await dialog.getByRole('textbox', { name: 'Clip gain (dB)', exact: true }).fill(String(db));
	await dialog.getByRole('button', { name: 'Apply', exact: true }).click();
	await expect(dialog).toBeHidden();
}

export async function readClipGain(properties) {
	const dialog = await openClipGainDialog(properties);
	const db = Number(await dialog.getByRole('textbox', { name: 'Clip gain (dB)', exact: true }).inputValue());
	await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
	await expect(dialog).toBeHidden();
	return db;
}

export async function expectClipGain(properties, db) {
	await expect.poll(() => readClipGain(properties)).toBe(db);
}
