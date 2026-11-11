import AxeBuilder from '@axe-core/playwright';
import { expect } from '@playwright/test';
import { test } from '../audio-editor-test-fixtures.js';

import { handbookPlan } from '../../../scripts/lib/product-web-routing.mjs';

// The handbook is served from a path on the product origin, so every route in
// this suite carries the base the deployment serves it under - in the URLs it
// navigates to and in the URLs it expects a followed link to land on. A link
// authored root-absolute in Markdown is rebased at build time, and asserting
// the base is how a link that missed that rebase is caught here rather than in
// production, where it would land on the editor instead of a handbook page.
const BASE = handbookPlan('soundscaper').scope;

test('publishes only Soundscaper tutorials on the Soundscaper origin', async ({ page }) => {
	await page.goto(BASE);
	await expect(page.getByRole('heading', { level: 1, name: 'Soundscaper Handbook' })).toBeVisible();
	await expect(page.getByRole('link', { name: /Framescaper/u })).toHaveCount(0);
	const foreignTutorial = await page.request.get(`${BASE}framescaper/first-project/`);
	expect(foreignTutorial.status()).toBe(404);
	const sharedChooser = await page.request.get(`${BASE}start/choose-an-editor/`);
	expect(sharedChooser.status()).toBe(404);
	await page.goto(`${BASE}soundscaper/edit-mix-and-export/`);
	await expect(page.locator('a[href*="framescaper.org/docs"]')).toHaveCount(0);
	await page.goto(BASE);
	await page.getByRole('link', { name: 'Start the first tutorial' }).click();
	await expect(page).toHaveURL(new RegExp(`${BASE}tutorials/your-first-project/$`, 'u'));
});

test('starts a newcomer on a tutorial and hands them on to the how-to guides', async ({ page }) => {
	await page.goto(`${BASE}tutorials/`);
	await expect(page.getByRole('heading', { level: 1, name: 'Tutorials' })).toBeVisible();
	await page.getByRole('link', { name: 'Your first Soundscaper project' }).first().click();
	await expect(page).toHaveURL(new RegExp(`${BASE}tutorials/your-first-project/$`, 'u'));
	// The example the tutorial is a lesson on is handed to the reader, not
	// merely named, and it comes from the assets bucket rather than the site.
	await expect(page.getByRole('link', { name: 'guide-music-loop.wav' })).toHaveAttribute('href', /^https:\/\/assets\.soundscaper\.org\/guides\/examples\/guide-music-loop\.wav$/u);
	await page.getByRole('link', { name: 'Fade in and fade out' }).first().click();
	await expect(page).toHaveURL(new RegExp(`${BASE}guides/volume/fade-in-and-fade-out/$`, 'u'));
});

test('reaches a guide through its category, and back out again', async ({ page }) => {
	await page.goto(`${BASE}guides/`);
	await expect(page.getByRole('heading', { level: 1, name: 'How-to guides' })).toBeVisible();

	// The index groups the guides by category, and each category heading is a
	// link to the category's own page rather than a bare label.
	await page.getByRole('heading', { level: 2, name: 'Volume and dynamics' }).getByRole('link').click();
	await expect(page).toHaveURL(new RegExp(`${BASE}guides/volume/$`, 'u'));
	await expect(page.getByRole('heading', { level: 1, name: 'Volume and dynamics' })).toBeVisible();

	await page.getByRole('link', { name: 'Normalize peaks to a set level' }).first().click();
	await expect(page).toHaveURL(new RegExp(`${BASE}guides/volume/normalize-peaks/$`, 'u'));
	await expect(page.getByRole('heading', { level: 1, name: 'Normalize peaks to a set level' })).toBeVisible();

	// Every guide leads back to the rest of its category and on to a related one.
	await page.getByRole('link', { name: 'Even out volume with a compressor' }).first().click();
	await expect(page).toHaveURL(new RegExp(`${BASE}guides/volume/even-out-volume-with-a-compressor/$`, 'u'));
});

test('local search indexes generated runtime references without cross-origin requests', async ({ page, baseURL }) => {
	const firstPartyOrigin = new URL(baseURL).origin;
	const crossOriginRequests = [];
	page.on('request', (request) => {
		const url = new URL(request.url());
		if (/^https?:$/u.test(url.protocol) && url.origin !== firstPartyOrigin) crossOriginRequests.push(url.href);
	});
	await page.goto(BASE);
	await page.getByRole('button', { name: 'Search' }).click();
	await page.getByPlaceholder('Search').fill('WavPack');
	const dialog = page.getByRole('dialog', { name: 'Search' });
	await expect(dialog.getByText(/\d+ results? for WavPack/u)).toBeVisible();
	await dialog.getByRole('link', { name: 'Export formats' }).click();
	await expect(page).toHaveURL(new RegExp(`${BASE}reference/generated/formats/$`, 'u'));
	await expect(page.getByRole('cell', { name: 'WavPack', exact: true })).toBeVisible();
	expect(crossOriginRequests).toEqual([]);
});

test('mobile readers can navigate the handbook sidebar', async ({ page }) => {
	await page.setViewportSize({ width: 390, height: 844 });
	await page.goto(`${BASE}soundscaper/recording/`);
	await page.getByRole('button', { name: /menu/iu }).click();
	await page.getByRole('link', { name: 'Storage, backups, and privacy' }).click();
	await expect(page).toHaveURL(new RegExp(`${BASE}projects-and-data/storage-backups-and-privacy/$`, 'u'));
});

test('states a local model purpose and keeps packaged-test mechanics collapsed', async ({ page }) => {
	await page.goto(`${BASE}reference/local-models/silero-vad-v6/`);
	await expect(page.getByRole('heading', { level: 2, name: 'Purpose and use case' })).toBeVisible();
	const disclosure = page.locator('details#what-the-packaged-test-checks');
	await expect(disclosure).not.toHaveAttribute('open', '');
	await expect(disclosure.getByText(/silero-voice-activity/u)).toBeHidden();
	await disclosure.locator('summary').click();
	await expect(disclosure.getByText(/silero-voice-activity/u)).toBeVisible();
});

test('gives the comparison page full width while standard pages keep their reading layout', async ({ page }) => {
	await page.setViewportSize({ width: 1600, height: 1000 });
	await page.goto(`${BASE}start/how-soundscaper-compares/`);
	const comparisonTitle = page.getByRole('heading', { level: 1, name: 'How Soundscaper compares' });
	await expect(comparisonTitle).toBeVisible();
	const comparisonWidth = (await comparisonTitle.boundingBox()).width;
	expect(comparisonWidth).toBeGreaterThan(900);
	const sidebarLink = page.getByRole('navigation', { name: 'Main', exact: true })
		.getByRole('link', { name: 'How Soundscaper compares', exact: true });
	const contents = page.getByRole('navigation', { name: 'On this page', exact: true });
	await expect(sidebarLink).toBeVisible();
	await expect(contents).toBeVisible();
	for (const width of [1600, 2400]) {
		await page.setViewportSize({ width, height: 1000 });
		const titleBox = await comparisonTitle.boundingBox();
		const sidebarBox = await sidebarLink.boundingBox();
		const contentsBox = await contents.boundingBox();
		expect(titleBox.x - (sidebarBox.x + sidebarBox.width)).toBeLessThanOrEqual(64);
		expect(contentsBox.x - (titleBox.x + titleBox.width)).toBeLessThanOrEqual(64);
		expect(contentsBox.width).toBeLessThanOrEqual(300);
	}

	await page.setViewportSize({ width: 1600, height: 1000 });
	await page.goto(`${BASE}soundscaper/recording/`);
	const standardTitle = page.getByRole('heading', { level: 1 });
	await expect(standardTitle).toBeVisible();
	expect((await standardTitle.boundingBox()).width).toBeLessThan(comparisonWidth - 180);
	await expect(page.getByRole('navigation', { name: 'On this page', exact: true })).toBeVisible();

	await page.setViewportSize({ width: 390, height: 844 });
	await page.goto(`${BASE}start/how-soundscaper-compares/`);
	await expect(comparisonTitle).toBeVisible();
	await expect(page.getByRole('navigation', { name: /^On this page/u })).toBeVisible();
	const pageWidth = await page.evaluate(() => ({ content: document.documentElement.scrollWidth, viewport: window.innerWidth }));
	expect(pageWidth.content).toBeLessThanOrEqual(pageWidth.viewport);
});

test('compares Web and Desktop with accessible symbols and explains the capability differences', async ({ page }) => {
	await page.goto(`${BASE}start/how-soundscaper-compares/`);
	await expect(page.getByRole('heading', { level: 1, name: 'How Soundscaper compares' })).toBeVisible();
	const tables = page.getByRole('table');
	expect(await tables.count()).toBeGreaterThan(0);
	for (const table of await tables.all()) {
		await expect(table.getByRole('columnheader')).toHaveText([
			'Capability', 'Soundscaper Web', 'Soundscaper Desktop', 'Audacity 4.0.2', 'Audition',
			'Pro Tools Studio', 'SoundCraft 0.19.0',
		]);
	}

	const colours = [];
	for (const [symbol, label] of [['+', 'Supported'], ['~', 'Limited'], ['/', 'Unavailable']]) {
		const verdict = tables.getByRole('img', { name: label, exact: true }).first();
		await expect(verdict).toHaveText(symbol);
		await expect(verdict).toBeVisible();
		colours.push(await verdict.evaluate((element) => getComputedStyle(element).color));
	}
	expect(new Set(colours).size).toBe(3);
	await expect(tables.getByText(/^(?:Yes|No|Partial)(?:\s|$)/u)).toHaveCount(0);
	const row = (capability) => page.getByRole('row').filter({
		has: page.getByRole('cell', { name: capability, exact: true }),
	});
	for (const [capability, web, desktop] of [
		['Dedicated single-file editor', 'Supported', 'Supported'],
		['Microphone and desktop audio together', 'Limited', 'Supported'],
		...['VST2 plug-ins', 'VST3 plug-ins', 'CLAP plug-ins', 'Audio Units (AU)', 'LV2 plug-ins', 'LADSPA plug-ins', 'Vamp analysers']
			.map((format) => [format, 'Unavailable', 'Supported']),
		['Speech enhancement', 'Unavailable', 'Supported'],
		['Transcription and diarisation', 'Unavailable', 'Supported'],
		['Source separation into stems', 'Unavailable', 'Supported'],
		['AAC (M4A)', 'Limited', 'Supported'],
		['MP3', 'Supported', 'Supported'],
	]) {
		await expect(row(capability).getByRole('cell').nth(1).getByRole('img', { name: web, exact: true })).toBeVisible();
		await expect(row(capability).getByRole('cell').nth(2).getByRole('img', { name: desktop, exact: true })).toBeVisible();
	}
	for (const column of [1, 2]) {
		await expect(row('Dedicated single-file editor').getByRole('cell').nth(column))
			.toContainText(/source monitor/iu);
	}
	await expect(row('Sample-level drawing').getByRole('cell').nth(3).getByRole('img', { name: 'Supported', exact: true })).toBeVisible();
	const audacityAutomation = row('Automation lanes').getByRole('cell').nth(3);
	await expect(audacityAutomation.getByRole('img', { name: 'Limited', exact: true })).toBeVisible();
	await expect(audacityAutomation).toContainText(/clip[ -]gain/iu);
	const audacityProjects = row('Opens Audacity projects').getByRole('cell').nth(3);
	const audacityProjectDetails = audacityProjects.getByRole('button');
	await expect(audacityProjectDetails).toHaveAccessibleDescription(/\baup\b.*\baup3\b.*\baup4\b.*import/iu);
	await expect(audacityProjectDetails).toHaveAccessibleDescription(/aup4\s+export/iu);
	await expect(audacityProjects).toContainText(/no\s+aup3\s+export/iu);
	for (const format of ['WAV', 'AIFF', 'BWF', 'RF64', 'BW64', 'ADM BWF', 'FLAC', 'WavPack', 'MP2', 'MP3', 'Opus', 'Ogg Vorbis', 'AAC (M4A)', 'MP4 video export', 'WebM video export', 'MOV video export']) {
		await expect(row(format)).toHaveCount(1);
		await expect(row(format).getByRole('cell')).toHaveCount(7);
	}
	await expect(row('AAC (M4A)').getByRole('cell').nth(3)).toContainText(/ffmpeg/iu);
	await expect(row('AAC (M4A)').getByRole('cell').nth(4).getByRole('img', { name: 'Unavailable', exact: true })).toBeVisible();
	await expect(row('FLAC').getByRole('cell').nth(5).getByRole('img', { name: 'Unavailable', exact: true })).toBeVisible();
	for (const [capability, states] of [
		['Click removal', ['Supported', 'Supported', 'Supported', 'Supported', 'Unavailable', 'Unavailable']],
		['Hum removal', ['Unavailable', 'Unavailable', 'Unavailable', 'Supported', 'Unavailable', 'Unavailable']],
		['De-essing', ['Supported', 'Supported', 'Unavailable', 'Supported', 'Supported', 'Supported']],
	]) {
		for (const [column, state] of states.entries()) {
			await expect(row(capability).getByRole('cell').nth(column + 1).getByRole('img', { name: state, exact: true })).toBeVisible();
		}
	}
	await expect(row('Click, hum, and sibilance tools')).toHaveCount(0);
	for (const format of ['EDL', 'OpenTimelineIO', 'FCPXML', 'OMF', 'DAWproject']) {
		for (const column of [1, 2]) {
			const cell = row(format).getByRole('cell').nth(column);
			await expect(cell.getByRole('img', { name: 'Supported', exact: true })).toBeVisible();
			await expect(cell.getByRole('button')).toHaveAccessibleDescription(/import and export/iu);
		}
	}
});

test('keeps comparison sources collapsed and reveals cell details on hover, focus, and tap', async ({ page, isMobile }) => {
	await page.goto(`${BASE}start/how-soundscaper-compares/`);
	const sources = page.getByText('Where these claims come from', { exact: true });
	const releaseNotes = page.getByRole('link', { name: 'release notes', exact: true });
	await expect(releaseNotes).toBeHidden();
	await sources.click();
	await expect(releaseNotes).toBeVisible();
	await sources.click();
	await expect(releaseNotes).toBeHidden();

	const row = (name) => page.getByRole('row').filter({ has: page.getByRole('cell', { name, exact: true }) });
	const project = row('Native project format').getByRole('cell').nth(1).getByRole('button');
	const detail = page.getByRole('tooltip').filter({ hasText: 'Media is bundled with the project.' });
	await expect(detail).toBeHidden();
	await project.hover();
	await expect(detail).toBeVisible();
	await detail.hover();
	await expect(detail).toBeVisible();
	await page.keyboard.press('Escape');
	await expect(detail).toBeHidden();
	await project.focus();
	await expect(detail).toBeVisible();
	await expect(project).toHaveAccessibleDescription('Media is bundled with the project.');
	await page.keyboard.press('Escape');
	await expect(detail).toBeHidden();
	if (isMobile) await project.tap();
	else await project.click();
	await expect(detail).toBeVisible();
	await page.getByRole('heading', { level: 1 }).click();
	await expect(detail).toBeHidden();

	for (const [name, column] of [
		['Spectrogram view', 5], ['De-reverb', 5], ['Phase and correlation meter', 6],
		['Text to speech', 5], ['Timed recording', 5], ['Snap to zero crossings', 5],
	]) {
		await expect(row(name).getByRole('cell').nth(column).getByRole('img', { name: 'Unavailable', exact: true })).toBeVisible();
	}
	const accessibility = await new AxeBuilder({ page }).include('main').analyze();
	expect(accessibility.violations.filter(({ impact }) => impact === 'serious' || impact === 'critical')).toEqual([]);
});

// The generated reference pages carry the widest and longest tables in the
// handbook, so one of each shape is checked: a short one and the effect
// inventory, whose parameter table is the largest the generator produces.
for (const route of [
	BASE,
	`${BASE}soundscaper/recording/`,
	`${BASE}reference/generated/formats/`,
	`${BASE}reference/generated/audio-effects/`,
	`${BASE}guides/`,
	`${BASE}guides/volume/normalize-peaks/`,
	`${BASE}tutorials/clean-up-a-voice-recording/`,
	`${BASE}start/how-soundscaper-compares/`,
]) {
	test(`has no serious accessibility violations at ${route}`, async ({ page }) => {
		await page.goto(route);
		const results = await new AxeBuilder({ page }).analyze();
		const serious = results.violations.filter(({ impact }) => impact === 'serious' || impact === 'critical');
		expect(serious).toEqual([]);
	});
}
