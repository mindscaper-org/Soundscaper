/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { chromium, firefox, webkit } from 'playwright-core';

const site = new URL(process.argv[2] ?? 'http://127.0.0.1:4321/en/');
const selected = process.argv[3];
const browsers = [chromium, firefox, webkit];
assert.ok(!selected || browsers.some((browser) => browser.name() === selected), 'Unknown browser');

async function verifyAutomationPages(page) {
	const action = (name) => page.getByRole('button', { name, exact: true });
	const file = page.getByText('File', { exact: true });
	const edit = page.getByText('Editing tools', { exact: true });
	const idle = page.locator('main[aria-busy="false"]');
	await page.goto(site.href);
	await file.click();
	await Promise.all([
		page.waitForEvent('dialog').then((dialog) => dialog.accept('Paged automation')),
		action('New project').click(),
	]);
	await page.getByRole('heading', { name: 'Paged automation', exact: true }).waitFor();
	await edit.click();
	await action('Track automation').click();
	const automation = page.getByRole('dialog', { name: 'Track automation', exact: true });
	const point = automation.getByRole('combobox', { name: 'Automation point' });
	const option = (label) => point.getByRole('option', { name: label, exact: true });
	const frame = automation.getByRole('spinbutton', { name: 'Frame' });
	const value = automation.getByRole('spinbutton', { name: 'Value' });
	for (let index = 0; index <= 32; index += 1) {
		await frame.fill(String(index * 128));
		await value.fill('-3');
		await action('Add point').click();
		await idle.waitFor();
	}
	await action('Next points').click();
	await point.selectOption({ label: '4096 · -3.000' });
	await value.fill('-5');
	await action('Update point').click();
	await idle.waitFor();
	assert.equal(await option('4096 · -5.000').count(), 1, 'updating a point keeps its page visible');
	assert.equal(await point.inputValue(), await option('4096 · -5.000').getAttribute('value'), 'the updated point stays selected');
	await action('Remove point').click();
	await idle.waitFor();
	assert.equal(await action('Previous points').count(), 0);
	assert.equal(await option('3968 · -3.000').count(), 1, 'removing the last point on a page returns to the preceding page');
	await action('Close').click();
	await edit.click();
	await action('Undo').click();
	await idle.waitFor();
	await edit.click();
	await action('Track automation').click();
	await action('Next points').click();
	await option('4096 · -5.000').waitFor({ state: 'attached' });
	await action('Clear curve').click();
	await idle.waitFor();
	assert.equal(await action('Previous points').count(), 0);
	assert.equal(await point.getByRole('option').count(), 1, 'clearing from a later page shows the empty curve');
}

for (const browserType of browsers.filter((browser) => !selected || browser.name() === selected)) {
	const browser = await browserType.launch();
	try {
		await verifyAutomationPages(await browser.newPage());
		console.log(`${browserType.name()} passed paginated Tracktion automation editing.`);
	} finally {
		await browser.close();
	}
}
