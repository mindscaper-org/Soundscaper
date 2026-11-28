/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { randomFillSync } from 'node:crypto';
import { mkdtemp, rm, stat, truncate, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { chromium, firefox, webkit, type Page } from 'playwright-core';

import { wavFixture } from '../native/soundscaper-tracktion/tests/wave_fixture.ts';

const mib = 1024 * 1024;
const site = new URL(process.argv[2] ?? 'http://127.0.0.1:4321/en/');
const browserTypes = [chromium, firefox, webkit];
const selected = process.argv[3];
assert.ok(!selected || browserTypes.some((browser) => browser.name() === selected), 'Unknown browser');

async function verifyArchives(page: Page, directory: string): Promise<void> {
	const project = 'Tracktion archive capacity';
	const recovered = 'Round-trip archive';
	const source = join(directory, 'Source.wav');
	const extra = join(directory, 'Extra.wav');
	const zip = join(directory, `${recovered}.zip`);
	const oversized = join(directory, 'Oversized.zip');
	const wave = wavFixture(Math.floor(15.9 * mib / 4));
	randomFillSync(wave, 44);
	await writeFile(source, wave);
	await writeFile(extra, wavFixture(mib / 4));
	await writeFile(oversized, '');
	await truncate(oversized, 65 * mib + 1);

	async function fileAction(label: string): Promise<void> {
		const menu = page.getByText('File', { exact: true });
		if (await menu.locator('..').getAttribute('open') === null) await menu.click();
		await page.getByRole('button', { name: label, exact: true }).click();
	}
	async function choose(action: string, path: string, replace = false): Promise<void> {
		const picked = page.waitForEvent('filechooser').then(async (chooser) => { await chooser.setFiles(path); });
		const confirmed = replace ? page.waitForEvent('dialog').then(async (dialog) => { await dialog.accept(); }) : undefined;
		await Promise.all([picked, confirmed, fileAction(action)]);
	}

	await page.goto(site.href);
	await page.getByRole('heading', { name: 'Soundscaper Tracktion', exact: true }).waitFor();
	const named = page.waitForEvent('dialog').then(async (dialog) => { await dialog.accept(project); });
	await Promise.all([named, fileAction('New project')]);
	await page.getByRole('heading', { name: project, exact: true }).waitFor();
	for (let clips = 1; clips <= 4; clips += 1) {
		await choose('Import audio', source);
		await page.getByText(`${clips} ${clips === 1 ? 'clip' : 'clips'}`, { exact: true }).waitFor();
	}
	const list = page.getByRole('list', { name: 'Audio clips' });
	const arrangement = await list.getByRole('listitem').allTextContents();
	const [download] = await Promise.all([page.waitForEvent('download'), fileAction('Export project archive (ZIP)')]);
	await download.saveAs(zip);
	const { size } = await stat(zip);
	assert.ok(size > 16 * mib && size <= 65 * mib, 'the fixture spans the original browser archive limit');
	await choose('Open project archive (ZIP)', zip, true);
	const recoveredTitle = page.getByRole('heading', { name: recovered, exact: true });
	await recoveredTitle.waitFor();
	assert.deepEqual(await list.getByRole('listitem').allTextContents(), arrangement);

	await choose('Import audio', extra);
	await page.getByText('5 clips', { exact: true }).waitFor();
	const unexpected = (downloaded: unknown) => assert.fail(`The oversized project unexpectedly downloaded ${String(downloaded)}`);
	page.on('download', unexpected);
	await fileAction('Export project archive (ZIP)');
	await page.getByRole('alert').filter({ hasText: '64 MiB uncompressed limit' }).waitFor();
	page.off('download', unexpected);
	await choose('Open project archive (ZIP)', oversized, true);
	await page.getByRole('alert').filter({ hasText: 'accepts ZIP files up to 65 MiB' }).waitFor();
	await recoveredTitle.waitFor();
	assert.equal(await list.getByRole('listitem').count(), 5);
	console.log(`Reopened ${size} bytes and refused oversized browser ZIP import and export.`);
}

for (const browserType of browserTypes.filter((browser) => !selected || browser.name() === selected)) {
	const directory = await mkdtemp(join(tmpdir(), 'tracktion-archive-bounds-'));
	const browser = await browserType.launch();
	try {
		const page = await browser.newPage();
		page.setDefaultTimeout(25_000);
		await verifyArchives(page, directory);
		console.log(`${browserType.name()} passed the browser Tracktion archive bounds.`);
	} finally {
		await browser.close();
		await rm(directory, { recursive: true, force: true });
	}
}
