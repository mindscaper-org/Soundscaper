/* SPDX-License-Identifier: AGPL-3.0-only */
import { expect, test, toneA } from './audio-editor-test-fixtures.js';
import {
	bootEditor, chooseCommandAction, chooseNestedCommandAction, closeWorkspacePanel,
	dockWorkspacePanel, importFiles,
} from './audio-editor-test-helpers.js';
import { installOscillatorMicrophone } from './helpers/complex-editing-workflows.js';
import { installWebVcrHost } from './helpers/web-vcr-host.js';

test('track name buttons enter the app-owned rename editor from the keyboard', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	const name = editor.getByRole('button', { name: 'Rename track: Track 1', exact: true });
	await name.focus();
	await name.press('F2');
	const input = editor.getByRole('textbox', { name: 'Track name: Track 1', exact: true });
	await expect(input).toBeFocused();
	await input.fill('Dialogue');
	await input.press('Enter');
	const renamed = editor.getByRole('button', { name: 'Rename track: Dialogue', exact: true });
	await expect(renamed).toBeVisible();
	await expect(editor.getByRole('group', { name: /^Dialogue, audio track$/u })).toHaveCount(1);
	await renamed.focus();
	await renamed.press('Enter');
	const reopened = editor.getByRole('textbox', { name: 'Track name: Dialogue', exact: true });
	await expect(reopened).toBeFocused();
	await reopened.press('Escape');
	await expect(renamed).toBeVisible();
});

test('mono capture route controls and History respect live recording admission', async ({ page }) => {
	await installOscillatorMicrophone(page);
	const editor = await bootEditor(page, '/embed/en/');
	await importFiles(editor, [toneA]);
	await chooseCommandAction(page, editor, 'View', 'Enable multi-track recording');
	const source = editor.getByRole('combobox', { name: /^Recording source:/u }).first();
	await source.selectOption('device:default');
	await expect.poll(() => page.evaluate(() => globalThis.__complexWorkflowStreams.length)).toBeGreaterThan(0);
	const width = editor.getByRole('combobox', { name: /^Track channels:/u }).first();
	await expect(width.getByRole('option', { name: 'Stereo', exact: true })).toHaveAttribute('disabled', '');
	await chooseCommandAction(page, editor, 'Window', 'History');
	const history = editor.locator('[data-workspace-panel="history"]');
	await expect(history.getByRole('button', { name: 'Undo', exact: true })).toBeEnabled();
	await editor.getByRole('button', { name: 'Record', exact: true }).click();
	await expect(history.getByRole('button', { name: 'Undo', exact: true })).toBeDisabled();
	await editor.getByRole('button', { name: 'Stop', exact: true }).click();
	await expect(history.getByRole('button', { name: 'Undo', exact: true })).toBeEnabled();
});

test('Web VCR accepts uppercase HTTPS and releases held keys before focus leaves', async ({ page }) => {
	await installWebVcrHost(page);
	const editor = await bootEditor(page, '/framescaper/en/');
	await editor.getByRole('button', { name: 'Capture options', exact: true }).click();
	await page.getByRole('menuitem', { name: 'Web VCR', exact: true }).click();
	const panel = editor.locator('[data-framescaper-web-vcr]');
	const address = panel.getByRole('textbox', { name: 'HTTPS address', exact: true });
	await address.fill('HTTPS://example.test/path');
	expect(await address.evaluate(input => input.checkValidity())).toBe(true);
	await panel.getByRole('button', { name: 'Go', exact: true }).click();
	await expect.poll(() => page.evaluate(() => globalThis.__framescaperWebVcrHarness.commands.filter(command => command.kind === 'navigate').length)).toBe(1);
	const interaction = panel.getByRole('application', { name: 'Interact with web page', exact: true });
	await interaction.focus();
	await page.keyboard.down('ArrowLeft');
	await page.keyboard.press('Escape');
	await expect(address).toBeFocused();
	await page.keyboard.up('ArrowLeft');
	const keys = await page.evaluate(() => globalThis.__framescaperWebVcrHarness.commands.filter(command => command.kind === 'key-input'));
	expect(keys.map(({ action, code }) => [action, code])).toEqual([['down', 'ArrowLeft'], ['up', 'ArrowLeft']]);
});

test('floating Web VCR targets its contained picture and keeps remote wheel events local to it', async ({ page }) => {
	await page.setViewportSize({ width: 1280, height: 900 });
	await installWebVcrHost(page);
	const editor = await bootEditor(page, '/framescaper/en/');
	await editor.getByRole('button', { name: 'Capture options', exact: true }).click();
	await page.getByRole('menuitem', { name: 'Web VCR', exact: true }).click();
	await dockWorkspacePanel(editor, 'web-vcr', 'floating');
	const resize = editor.locator('[data-floating-panel-resize-handle="web-vcr"]');
	await resize.focus();
	for (let step = 0; step < 5; step++) await resize.press('ArrowLeft');
	const interaction = editor.getByRole('application', { name: 'Interact with web page', exact: true });
	const video = editor.getByLabel('Web page preview', { exact: true });
	await expect.poll(() => video.evaluate(element => element.videoWidth)).toBeGreaterThan(0);
	const picture = await video.evaluate(element => {
		const box = element.getBoundingClientRect();
		const scale = Math.min(box.width / element.videoWidth, box.height / element.videoHeight);
		const width = element.videoWidth * scale, height = element.videoHeight * scale;
		return { x: box.x + (box.width - width) / 2, y: box.y + (box.height - height) / 2, width, height };
	});
	await page.mouse.click(picture.x + picture.width / 2, picture.y + picture.height * 0.1);
	const point = await page.evaluate(() => globalThis.__framescaperWebVcrHarness.commands.filter(command => command.kind === 'pointer-input' && command.action === 'down').at(-1));
	expect(point.x).toBeCloseTo(0.5, 2);
	expect(point.y).toBeCloseTo(0.1, 2);
	await interaction.evaluate(element => {
		globalThis.__auditWheelPrevented = null;
		element.addEventListener('wheel', event => queueMicrotask(() => { globalThis.__auditWheelPrevented = event.defaultPrevented; }), { passive: true });
	});
	await interaction.hover();
	await page.mouse.wheel(0, 80);
	await expect.poll(() => page.evaluate(() => globalThis.__auditWheelPrevented)).toBe(true);
});

test('the main clock accepts explicit positive and negative sequence labels across zero', async ({ page }) => {
	const editor = await bootEditor(page, '/framescaper/embed/en/');
	await chooseNestedCommandAction(page, editor, 'File', ['Project management', 'Project properties']);
	const metadata = editor.locator('[data-workspace-panel="metadata"]');
	await metadata.getByRole('tab', { name: 'Sequence timing', exact: true }).click();
	const origin = metadata.locator('[data-sequence-start-timecode]');
	await origin.fill('-00:00:02:00');
	await origin.press('Tab');
	await expect(origin).toHaveAttribute('data-sequence-start-timecode', '-00:00:02:00');
	await closeWorkspacePanel(editor, 'metadata');
	const readout = editor.locator('[data-sequence-timecode]');
	const clock = editor.locator('[data-time-display] .timecode');
	for (const [text, expected] of [['+1', '00:00:01:00'], ['-00:00:01:00', '-00:00:01:00']]) {
		await clock.dblclick();
		const input = clock.getByRole('textbox', { name: 'Playhead', exact: true });
		await input.fill(text);
		await expect(input).toHaveAttribute('aria-invalid', 'false');
		await input.press('Enter');
		await expect(readout).toHaveAttribute('data-sequence-timecode', expected);
	}
});

test('sample precision hold times commit as visible integer milliseconds', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await editor.getByRole('button', { name: 'Record options', exact: true }).click();
	await page.getByRole('dialog', { name: 'Record options', exact: true }).getByRole('button', { name: 'Sound activation', exact: true }).click();
	const settings = page.getByRole('dialog', { name: 'Sound activation', exact: true });
	await settings.getByRole('button', { name: 'Hold after silence: format', exact: true }).click();
	await page.getByRole('menuitem', { name: 'samples', exact: true }).click();
	await settings.getByRole('group', { name: 'Hold after silence', exact: true }).dblclick();
	const input = settings.getByRole('textbox', { name: 'Hold after silence', exact: true });
	await input.fill('1');
	await input.press('Enter');
	const panel = settings.locator('[data-sound-activation-settings]');
	await expect(panel).toHaveAttribute('data-sound-activation-hold-milliseconds', '0');
	await expect(settings.getByRole('alert')).toHaveCount(0);
});

test('community import errors preserve the exact rejected translation key', async ({ page }) => {
	const editor = await bootEditor(page, '/embed/en/');
	await chooseCommandAction(page, editor, 'Help', 'Contribute translations');
	const surface = page.getByRole('dialog', { name: 'Community translations', exact: true });
	await expect(surface.getByRole('textbox', { name: 'English source', exact: true })).toBeVisible();
	const locale = await surface.getByRole('combobox', { name: 'Translation language', exact: true }).inputValue();
	const entry = { key: 'literal $& key', source: 'Source', baselineText: 'Text', baselineEntry: null, translation: 'Text' };
	const payload = { version: 1, locale, snapshotId: 'duplicate-import', entries: [entry, entry] };
	const chooser = page.waitForEvent('filechooser');
	await surface.getByRole('button', { name: 'Import a translation file', exact: true }).click();
	await (await chooser).setFiles({ name: 'duplicate.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(payload)) });
	await expect(surface.getByRole('alert')).toContainText('Duplicate translation key: literal $& key');
});

test('Freesound waveform seeking is operable from the keyboard', async ({ page }) => {
	const sound = {
		id: 42, name: 'Harbor ambience', pageUrl: 'https://freesound.org/s/42/',
		creator: { username: 'field-recorder', pageUrl: 'https://freesound.org/people/field-recorder/' },
		description: 'Waves and wind.', tags: ['harbor'], category: null, subcategory: null,
		createdAt: '2026-01-02T03:04:05Z', generativeAiPreference: null, explicit: false,
		license: { code: 'cc0', name: 'Creative Commons 0', url: 'https://creativecommons.org/publicdomain/zero/1.0/', requiresAttribution: false, commercialUseAllowed: true },
		durationSeconds: 0.8, originalFile: { format: 'wav', channels: 2, byteLength: 153644, sampleRate: 48000, md5: '0123456789abcdef0123456789abcdef' },
		statistics: { downloads: 42, averageRating: 4.75, ratingCount: 8 },
		preview: { available: true, format: 'ogg', quality: 'high', approximateBitrateKbps: 192 },
		waveform: { available: true, url: '/api/freesound/sounds/42/waveform?asset=789&source=cdn' },
	};
	await page.addInitScript(() => {
		globalThis.__auditPreviewSeeks = [];
		const descriptor = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'currentTime');
		Object.defineProperty(HTMLMediaElement.prototype, 'currentTime', {
			...descriptor, get() { return descriptor.get.call(this); },
			set(value) { globalThis.__auditPreviewSeeks.push(value); descriptor.set.call(this, value); },
		});
	});
	await page.route('**/api/freesound/**', async route => {
		const path = new URL(route.request().url()).pathname;
		if (path === '/api/freesound/oauth/session') return route.fulfill({ json: { data: { connected: false } } });
		if (path === '/api/freesound/search') return route.fulfill({ json: { data: { query: 'harbor', page: 1, pageSize: 20, totalCount: 1, totalPages: 1, hasNextPage: false, hasPreviousPage: false, results: [sound] } } });
		if (path.endsWith('/waveform')) return route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="128" height="24"><path d="M0 12H128" stroke="blue"/></svg>' });
		if (path.endsWith('/preview')) return route.fulfill({ contentType: 'audio/wav', body: toneA.buffer });
		return route.fulfill({ json: { data: sound } });
	});
	const editor = await bootEditor(page, '/embed/en/');
	await chooseCommandAction(page, editor, 'Window', 'Freesound');
	const panel = editor.locator('[data-workspace-panel="freesound"]');
	await panel.getByRole('searchbox', { name: 'Search Freesound', exact: true }).fill('harbor');
	await panel.getByRole('button', { name: 'Search', exact: true }).click();
	const waveform = panel.getByRole('slider', { name: 'Seek and play preview: Harbor ambience', exact: true });
	await expect(waveform).toBeVisible();
	await waveform.focus();
	await waveform.press('ArrowRight');
	await expect.poll(() => page.evaluate(() => globalThis.__auditPreviewSeeks.at(-1))).toBeGreaterThan(0);
	await waveform.press('Home');
	await expect.poll(() => page.evaluate(() => globalThis.__auditPreviewSeeks.at(-1))).toBe(0);
	await waveform.press('End');
	await expect.poll(() => page.evaluate(() => globalThis.__auditPreviewSeeks.at(-1))).toBe(0.8);
});
