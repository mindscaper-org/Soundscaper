/* SPDX-License-Identifier: AGPL-3.0-only */
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import type { Locator } from '@playwright/test';
import { expect, test } from './helpers/browser-coverage-fixture.js';
import { resolveBrowserProductTestUrl } from './helpers/browser-product-test-url.js';
import { CURVE_PNG_BASE64, CURVE_SOURCE } from './helpers/lightscaper-curve-reference.ts';
import { editLightscaperDevelopNumberCurrentV1 } from './helpers/lightscaper-develop-numeric-keyboard-current.ts';
import { bundledLightscaperEditorCopyForLocale } from '../../src/common/i18n/lightscaper-editor-copy.ts';
import { photoDevelopCopy } from '../../src/common/i18n/lightscaper-develop-copy.ts';
import { photoDevelopMenuLabel } from '../../src/common/i18n/lightscaper-develop-menu-copy.ts';
import type { readManagedFallbackUiPhotoCurrentV1 } from './helpers/lightscaper-managed-fallback-ui-current.ts';

type Observation = Awaited<ReturnType<typeof readManagedFallbackUiPhotoCurrentV1>>;
const NAME = 'WebKit retained original.png', PROGRAM = '/__lightscaper_managed_fallback_observer.js';
const PNG = Buffer.from(CURVE_PNG_BASE64, 'base64'), SHA = createHash('sha256').update(PNG).digest('hex');
const coverageOptions: Parameters<typeof test.use>[0] & Readonly<{ browserCoverage: boolean }> = { browserCoverage: false };
test.use(coverageOptions);

test('WebKit real menu import, Develop Save and reload retain exact native IndexedDB fallback bytes, metadata and painted pixels', async ({ page, browserName }) => {
	test.skip(browserName !== 'webkit', 'This case positively qualifies the installed WebKit IndexedDB Blob fallback.');
	test.setTimeout(45_000);
	const copy = bundledLightscaperEditorCopyForLocale('en'), words = photoDevelopCopy('en'), errors: string[] = [];
	page.on('pageerror', error => { errors.push(error.message); });
	const bundle = await build({ entryPoints: [fileURLToPath(new URL('./helpers/lightscaper-managed-fallback-ui-current.ts', import.meta.url))],
		bundle: true, write: false, format: 'esm', platform: 'browser', external: ['module'] });
	const script = bundle.outputFiles[0]?.text; if (script === undefined) throw new Error('Actual fallback read observer was not bundled.');
	await page.route(`**${PROGRAM}`, async route => {
		const response = await route.fetch(), headers = response.headers();
		delete headers['content-length']; delete headers['content-encoding']; headers['content-type'] = 'text/javascript';
		try { await route.fulfill({ status: 200, headers, body: script }); } finally { await response.dispose(); }
	});
	await page.goto(resolveBrowserProductTestUrl('/lightscaper/en/'));
	const app = page.locator('[data-lightscaper-bound="true"]'); await expect(app).toBeVisible();
	const opfsExposed = await page.evaluate(() => typeof navigator.storage?.getDirectory === 'function');
	test.skip(opfsExposed, 'This positive fallback regression requires genuinely unavailable OPFS; this WebKit exposes native getDirectory.');
	await fileAction(copy.photoImportPhotos);
	const importer = page.getByRole('dialog', { name: copy.photoImportPhotos, exact: true });
	await importer.getByLabel(copy.photoChooseFiles, { exact: true }).setInputFiles({ name: NAME, mimeType: 'image/png', buffer: PNG });
	await key(importer.getByRole('button', { name: copy.photoImportAction, exact: true })); await expect(importer).toHaveCount(0);
	const library = app.locator('[data-photo-library]'), card = library.locator('[data-photo-id]');
	await expect(card).toHaveCount(1); await expect(library).toHaveAttribute('aria-busy', 'false');
	await expect(library.locator('[data-photo-import-status="imported"]')).toHaveCount(1);
	const photoId = await card.getAttribute('data-photo-id'); if (!photoId) throw new Error('Actual imported Photo ID is missing.');
	const initial = await observe(photoId);
	expect(initial.storage).toBe('indexeddb-blob'); expect(initial.bodySha256).toBe(SHA); expect(initial.bodyByteLength).toBe(PNG.byteLength);
	expect(initial.photo.metadata.fileName).toBe(NAME); expect(initial.photo.original).toMatchObject({ name: NAME, mimeType: 'image/png', width: 2, height: 2, retention: 'managed' });
	await key(card); await openDevelop();
	const dialog = page.getByRole('dialog', { name: `${words.title}: ${NAME}`, exact: true }), preview = dialog.locator('[data-photo-develop-preview]');
	await expect(preview).toHaveAttribute('data-state', 'ready');
	await expect.poll(() => pixels(dialog.locator('[data-photo-develop-before]'))).toEqual([2, 2, ...CURVE_SOURCE]);
	await expect.poll(() => pixels(dialog.locator('[data-photo-develop-after]'))).toEqual([2, 2, ...CURVE_SOURCE]);
	await dialog.getByRole('combobox', { name: words.choose, exact: true }).selectOption('tone-ladder-v1');
	await key(dialog.getByRole('button', { name: words.add, exact: true }));
	const exposure = dialog.getByRole('spinbutton', { name: `${words.shared.videoEffectExactValue}: ${words.shared.videoEffectParamExposure}`, exact: true });
	await editLightscaperDevelopNumberCurrentV1(exposure, '-1'); await expect(exposure).toHaveValue('-1');
	await expect(preview).toHaveAttribute('data-state', 'ready');
	await expect.poll(async () => (await pixels(dialog.locator('[data-photo-develop-after]')))[6]).toBeLessThan(CURVE_SOURCE[4]!);
	await key(dialog.getByRole('button', { name: words.save, exact: true }));
	await expect(dialog.locator('[data-photo-develop-ack]')).toContainText(words.acknowledged);
	await expect(dialog.getByRole('button', { name: words.save, exact: true })).toBeDisabled();
	await expect(dialog.getByRole('button', { name: words.cancel, exact: true })).toBeDisabled();
	await expect(preview).toHaveAttribute('data-state', 'ready');
	const retainedPixels = await pixels(dialog.locator('[data-photo-develop-after]'));
	await closeDevelop();
	const saved = await observe(photoId);
	expect(saved.photo.revision).toBe(initial.photo.revision + 1); expect(saved.photo.original).toEqual(initial.photo.original);
	expect(saved.photo.metadata).toEqual(initial.photo.metadata); expect(saved.photo.extractedMetadata).toEqual(initial.photo.extractedMetadata);
	expect(saved.bodySha256).toBe(SHA); expect(saved.custody).toEqual(initial.custody);
	const version = saved.photo.versions.find(version => version.id === saved.photo.activeVersionId); if (!version) throw new Error('Actual saved active version is missing.');
	expect(version.develop.effects).toHaveLength(1); expect(version.develop.effects[0]).toMatchObject({ type: 'tone-ladder-v1', enabled: true, params: { exposure: -1 } });
	await page.reload(); await expect(app).toBeVisible();
	await menu(copy.photoViewMenu); await key(app.getByRole('button', { name: copy.photoShowLibrary, exact: true }));
	await expect(card).toHaveCount(1); await expect(library).toHaveAttribute('aria-busy', 'false');
	expect(await card.getAttribute('data-photo-id')).toBe(photoId); expect(await observe(photoId)).toEqual(saved);
	await key(card); await openDevelop(); await expect(preview).toHaveAttribute('data-state', 'ready');
	await expect(exposure).toHaveValue('-1');
	await expect.poll(() => pixels(dialog.locator('[data-photo-develop-before]'))).toEqual([2, 2, ...CURVE_SOURCE]);
	await expect.poll(() => pixels(dialog.locator('[data-photo-develop-after]'))).toEqual(retainedPixels);
	await expect(dialog.getByRole('alert')).toHaveCount(0); await closeDevelop(); expect(errors).toEqual([]);

	async function key(control: Locator) { await expect(control).toBeEnabled(); await control.focus(); await expect(control).toBeFocused(); await control.press('Enter'); }
	async function menu(label: string) { const escaped = label.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'); const summary = app.getByRole('navigation').locator('summary').filter({ hasText: new RegExp(`^${escaped}$`, 'u') });
		if (await summary.evaluate(node => !node.parentElement?.hasAttribute('open'))) await key(summary); }
	async function fileAction(label: string, photo = false) { await menu(copy.photoFileMenu); if (photo) await menu(copy.photoPhotoMenu); await key(app.getByRole('button', { name: label, exact: true })); }
	async function openDevelop() { await fileAction(photoDevelopMenuLabel('en'), true); }
	async function closeDevelop() { await key(dialog.getByRole('button', { name: words.close, exact: true }).last()); await expect(dialog).toHaveCount(0); }
	async function observe(photoId: string): Promise<Observation> { return page.evaluate(async ({ pathname, photoId }) => {
		const owner = await import(new URL(pathname, location.href).href) as typeof import('./helpers/lightscaper-managed-fallback-ui-current.ts');
		return await owner.readManagedFallbackUiPhotoCurrentV1(photoId);
	}, { pathname: PROGRAM, photoId }); }
});

async function pixels(canvas: Locator): Promise<number[]> {
	return canvas.evaluate(element => {
		if (!(element instanceof HTMLCanvasElement)) throw new TypeError('Actual Develop target is not a native canvas.');
		const context = element.getContext('2d'); if (!context) throw new Error('Actual Develop 2D context is missing.');
		return [element.width, element.height, ...context.getImageData(0, 0, element.width, element.height).data];
	});
}
