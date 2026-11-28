/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import type { Locator, Page } from 'playwright-core';

import { wavFixture, waveData } from '../../native/soundscaper-tracktion/tests/wave_fixture.ts';

type MixerRenderWindow = Window & { tracktionMixerRender?: Blob };

async function assertFitsWidth(locator: Locator, label: string): Promise<void> {
	const { left, right, viewport } = await locator.evaluate((element) => {
		const { left, right } = element.getBoundingClientRect();
		return { left, right, viewport: element.ownerDocument.documentElement.clientWidth };
	});
	assert.ok(left >= -1 && right <= viewport + 1, `${label} extends past the ${viewport}px viewport (${left}–${right}px)`);
}

export async function verifyTracktionNarrowMenus(page: Page, site: URL): Promise<void> {
	const nav = page.getByRole('navigation', { name: 'Application menu', exact: true });
	const file = nav.getByText('File', { exact: true });
	const editing = nav.getByText('Editing tools', { exact: true });
	const transport = nav.getByText('Playback and recording', { exact: true });
	const open = nav.getByRole('button', { name: 'Open projects', exact: true });
	const create = nav.getByRole('button', { name: 'New project', exact: true });
	const record = nav.getByRole('button', { name: 'Record onto the active track', exact: true });
	await page.goto(site.href);
	await page.getByRole('heading', { name: 'Soundscaper Tracktion', exact: true }).waitFor();
	for (const [summary, label] of [[file, 'File'], [editing, 'Editing tools'], [transport, 'Playback and recording']] as const) {
		await assertFitsWidth(summary, label);
	}
	await file.tap();
	await assertFitsWidth(open, 'Open projects');
	await open.tap();
	const chooser = page.getByRole('dialog', { name: 'Local projects', exact: true });
	await chooser.getByRole('button', { name: 'Cancel', exact: true }).tap();
	await chooser.waitFor({ state: 'detached' });
	await file.tap();
	const name = `FieldRecordingSession_${'locationNotes_'.repeat(7)}T001`;
	await Promise.all([page.waitForEvent('dialog').then((dialog) => dialog.accept(name)), create.tap()]);
	await assertFitsWidth(page.getByRole('heading', { name, exact: true }), 'The created project');
	await file.tap();
	const track = page.getByRole('combobox', { name: 'Track', exact: true });
	await track.evaluate((element) => {
		element.addEventListener('click', (event) => { element.setAttribute('data-clicked', String(event.isTrusted)); }, { once: true });
	});
	await track.tap();
	assert.equal(await file.locator('..').getAttribute('open'), null);
	assert.equal(await track.getAttribute('data-clicked'), 'true', 'dismissing the menu preserves the touch on the track selector');
	await page.keyboard.press('Escape');
	await transport.tap();
	await assertFitsWidth(record, 'Record onto the active track');
	assert.equal(await record.isEnabled(), true, 'The narrow transport menu exposes an enabled Record action');
	await assertFitsWidth(file, 'File with the transport menu open');
	await transport.tap();
	await verifyNarrowTrimDialog(page, nav, file, editing);
	await verifyNarrowSavedChooser(page, nav, file, name);
	await verifyNarrowMoveRetry(page, nav, editing);
	await verifyNarrowMixerPrecision(page, nav, file, editing);
}

async function verifyNarrowMixerPrecision(page: Page, nav: Locator, file: Locator, editing: Locator): Promise<void> {
	const sample = wavFixture(512);
	for (let frame = 0; frame < 512; frame += 1) {
		sample.writeInt16LE(28_000, 44 + frame * 4);
		sample.writeInt16LE(-27_000, 46 + frame * 4);
	}
	await file.tap();
	const selection = page.waitForEvent('filechooser').then((picker) => picker.setFiles({
		name: 'Mixer precision.wav', mimeType: 'audio/wav', buffer: sample,
	}));
	await Promise.all([selection, nav.getByRole('button', { name: 'Import audio', exact: true }).tap()]);
	await page.getByText(/^Mixer precision \(/u).waitFor();
	await page.evaluate(() => {
		const create = URL.createObjectURL;
		URL.createObjectURL = (object) => {
			if (object instanceof Blob && object.type === 'audio/wav') (window as MixerRenderWindow).tracktionMixerRender = object;
			return create.call(URL, object);
		};
	});
	const mixer = page.getByRole('dialog', { name: 'Mixer', exact: true });
	const gain = mixer.getByRole('spinbutton', { name: /Gain/u });
	const apply = mixer.getByRole('button', { name: 'Apply', exact: true });
	async function openMixer(): Promise<void> {
		await editing.tap();
		await nav.getByRole('button', { name: 'Mixer', exact: true }).tap();
	}
	async function render(): Promise<Buffer> {
		await page.evaluate(() => { (window as MixerRenderWindow).tracktionMixerRender = undefined; });
		await file.tap();
		await nav.getByRole('button', { name: 'Export mix (WAV)', exact: true }).tap();
		await page.waitForFunction(() => Boolean((window as MixerRenderWindow).tracktionMixerRender));
		return waveData(Buffer.from(await page.evaluate(async () => {
			const rendered = (window as MixerRenderWindow).tracktionMixerRender;
			if (!rendered) throw new Error('Tracktion did not render the mix');
			return Array.from(new Uint8Array(await rendered.arrayBuffer()));
		})));
	}
	await openMixer();
	await gain.fill('-0.00045');
	await apply.tap();
	const precise = await render();
	await openMixer();
	assert.equal(await gain.inputValue(), '0');
	await mixer.getByRole('checkbox', { name: 'Solo', exact: true }).check();
	await apply.tap();
	assert.deepEqual(await render(), precise, 'Solo preserves the untouched fractional gain');
	await openMixer();
	await gain.focus();
	await page.keyboard.press('ControlOrMeta+a');
	await page.keyboard.type('0');
	await apply.tap();
	assert.notDeepEqual(await render(), precise, 'expressly entering zero changes the fractional gain');
}

async function verifyNarrowMoveRetry(page: Page, nav: Locator, editing: Locator): Promise<void> {
	await editing.tap();
	await nav.getByRole('button', { name: 'Move clip', exact: true }).tap();
	const move = page.getByRole('dialog', { name: 'Move clip', exact: true });
	const start = move.getByRole('spinbutton', { name: 'Start frame', exact: true });
	await start.fill('1000000000000');
	await page.keyboard.press('Enter');
	await move.getByRole('alert').filter({ hasText: 'Timeline frame is outside the Edit' }).waitFor();
	assert.equal(await start.evaluate((element) => element === element.ownerDocument.activeElement), true, 'the refused edit retains its frame field focus');
	await page.keyboard.press('ControlOrMeta+a');
	await page.keyboard.type('64');
	await page.keyboard.press('Enter');
	await move.waitFor({ state: 'detached' });
	await page.getByText(/TAKE_001 \(64–832\)$/u).waitFor();
}

async function verifyNarrowTrimDialog(page: Page, nav: Locator, file: Locator, editing: Locator): Promise<void> {
	const sharedStem = `Field_recording_${'location-project-notes_'.repeat(4)}`;
	const first = `${sharedStem}TAKE_001`;
	const second = `${sharedStem}TAKE_002`;
	for (const [stem, start] of [[first, 0], [second, 768]] as const) {
		await file.tap();
		const selection = page.waitForEvent('filechooser').then((picker) => picker.setFiles({
			name: `${stem}.wav`, mimeType: 'audio/wav', buffer: wavFixture(768),
		}));
		await Promise.all([selection, nav.getByRole('button', { name: 'Import audio', exact: true }).tap()]);
		await page.getByText(`${stem} (${start}–${start + 768})`, { exact: true }).waitFor();
	}
	await editing.tap();
	await nav.getByRole('button', { name: 'Trim clip', exact: true }).tap();
	const trim = page.getByRole('dialog', { name: 'Trim clip', exact: true });
	const clip = trim.getByRole('combobox', { name: 'Clip', exact: true });
	await assertFitsWidth(clip, 'The Clip selector with long source names');
	assert.equal(await trim.evaluate((element) => element.scrollWidth - element.clientWidth), 0);
	const target = `${second} (768–1536)`;
	assert.deepEqual(await clip.getByRole('option').allTextContents(), [`${first} (0–768)`, target]);
	await clip.selectOption({ label: target });
	await trim.getByRole('spinbutton', { name: 'Start frame', exact: true }).fill('784');
	await trim.getByRole('spinbutton', { name: 'End frame', exact: true }).fill('1520');
	await trim.getByRole('button', { name: 'Apply', exact: true }).tap();
	await trim.waitFor({ state: 'detached' });
	await page.getByText(`${second} (784–1520)`, { exact: true }).waitFor();
	await page.getByText(`${first} (0–768)`, { exact: true }).waitFor();
}

async function verifyNarrowSavedChooser(page: Page, nav: Locator, file: Locator, title: string): Promise<void> {
	await file.tap();
	await nav.getByRole('button', { name: 'Save project', exact: true }).tap();
	await page.getByRole('status').filter({ hasText: 'All changes saved locally' }).waitFor();
	await file.tap();
	await nav.getByRole('button', { name: 'Close project', exact: true }).tap();
	await page.getByRole('heading', { name: 'Soundscaper Tracktion', exact: true }).waitFor();
	await file.tap();
	await nav.getByRole('button', { name: 'Open projects', exact: true }).tap();
	const chooser = page.getByRole('dialog', { name: 'Local projects', exact: true });
	const choice = chooser.getByRole('button', { name: title, exact: true });
	await assertFitsWidth(choice, 'The saved project with a long name');
	assert.equal(await chooser.evaluate((element) => element.scrollWidth - element.clientWidth), 0);
	assert.equal(await choice.evaluate((element) => {
		const { left, right } = element.getBoundingClientRect();
		const content = element.ownerDocument.createRange();
		content.selectNodeContents(element);
		const lines = [...content.getClientRects()];
		return lines.length > 1 && lines.every((line) => line.left >= left && line.right <= right);
	}), true, 'The complete saved project name wraps within its button');
	await choice.tap();
	await page.getByRole('heading', { name: title, exact: true }).waitFor();
	await page.getByText(/TAKE_002 \(784–1520\)$/u).waitFor();
}
