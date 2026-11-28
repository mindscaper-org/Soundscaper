/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import type { Locator, Page } from 'playwright-core';

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
	const name = 'Narrow Soundscaper project';
	await Promise.all([page.waitForEvent('dialog').then((dialog) => dialog.accept(name)), create.tap()]);
	await assertFitsWidth(page.getByRole('heading', { name, exact: true }), 'The created project');
	await transport.tap();
	await assertFitsWidth(record, 'Record onto the active track');
	assert.equal(await record.isEnabled(), true, 'The narrow transport menu exposes an enabled Record action');
	await assertFitsWidth(file, 'File with the transport menu open');
}
