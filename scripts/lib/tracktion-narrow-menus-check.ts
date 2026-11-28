/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import type { Locator, Page } from 'playwright-core';

import { wavFixture } from '../../native/soundscaper-tracktion/tests/wave_fixture.ts';

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
	await transport.tap();
	await assertFitsWidth(record, 'Record onto the active track');
	assert.equal(await record.isEnabled(), true, 'The narrow transport menu exposes an enabled Record action');
	await assertFitsWidth(file, 'File with the transport menu open');
	await transport.tap();
	await verifyNarrowTrimDialog(page, nav, file, editing);
	await verifyNarrowSavedChooser(page, nav, file, name);
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
