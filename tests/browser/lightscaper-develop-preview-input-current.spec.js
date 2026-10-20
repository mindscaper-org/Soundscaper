/* SPDX-License-Identifier: AGPL-3.0-only */
import { expect, test } from './helpers/browser-coverage-fixture.js';
import { resolveBrowserProductTestUrl } from './helpers/browser-product-test-url.js';
import { bundledLightscaperEditorCopyForLocale } from '../../src/common/i18n/lightscaper-editor-copy.ts';
import { photoDevelopCopy } from '../../src/common/i18n/lightscaper-develop-copy.ts';
import { photoDevelopMenuLabel } from '../../src/common/i18n/lightscaper-develop-menu-copy.ts';
import { photoDevelopSettingsCopy } from '../../src/common/i18n/lightscaper-develop-settings-copy.ts';
import { photoDevelopInputQualityCopy } from '../../src/common/i18n/lightscaper-develop-input-quality-copy.ts';
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACAQMAAABIeJ9nAAAAIGNIUk0AAHomAACAhAAA+gAAAIDoAAB1MAAA6mAAADqYAAAXcJy6UTwAAAAGUExURf8gAP///4DcGxUAAAABYktHRAH/Ai3eAAAAB3RJTUUH6ggZEjoj/gYZhQAAAAxJREFUCNdjYGBgAAAABAABJzQnCgAAAABJRU5ErkJggg==', 'base64');
test.use({ browserCoverage: false });
for (const locale of ['en', 'de']) test(`${locale}: cached Develop input is opt-in, identified, preview-only and resets with its workspace`, async ({ page }) => {
	const copy = bundledLightscaperEditorCopyForLocale(locale), develop = photoDevelopCopy(locale), settings = photoDevelopSettingsCopy(locale, 'current3'), quality = photoDevelopInputQualityCopy(locale);
	await page.goto(resolveBrowserProductTestUrl(`/lightscaper/${locale}/`));
	const app = page.locator('[data-lightscaper-bound="true"]'); await expect(app).toBeVisible();
	await expect(app.locator('[data-photo-develop-input-menu]')).toHaveCount(0);
	await action(copy.photoImportPhotos);
	let dialog = page.getByRole('dialog', { name: copy.photoImportPhotos, exact: true });
	await dialog.getByLabel(copy.photoChooseFiles, { exact: true }).setInputFiles({ name: 'Cached input.png', mimeType: 'image/png', buffer: PNG });
	await key(dialog.getByRole('button', { name: copy.photoImportAction, exact: true })); await expect(dialog).toHaveCount(0);
	const card = app.locator('[data-photo-id]'); await expect(card).toHaveCount(1); await key(card);
	await open();
	let preview = dialog.locator('[data-photo-develop-preview]');
	await expect(preview).toHaveAttribute('data-state', 'ready'); await expect(preview).toHaveAttribute('data-input-quality', 'original');
	await expect(dialog.locator('[data-photo-develop-input-quality]')).toHaveCount(0);
	const original = await pixels();
	await menu(dialog, settings.menu); await menu(dialog, quality.menu); await key(dialog.getByRole('button', { name: quality.preview, exact: true }));
	await expect(preview).toHaveAttribute('data-input-quality', 'preview-derivative'); await expect(preview).toHaveAttribute('data-state', 'ready');
	await expect(dialog.locator('[data-photo-develop-input-quality]')).toHaveText(quality.notice);
	await expect(dialog.getByRole('button', { name: develop.fullResolution, exact: true })).toBeDisabled(); expect(await pixels()).toEqual(original);
	await key(dialog.getByRole('button', { name: quality.original, exact: true })); await expect(preview).toHaveAttribute('data-state', 'ready');
	await expect(preview).toHaveAttribute('data-input-quality', 'original'); await expect(dialog.getByRole('button', { name: develop.fullResolution, exact: true })).toBeEnabled();
	await key(dialog.getByRole('button', { name: quality.preview, exact: true })); await expect(preview).toHaveAttribute('data-state', 'ready');
	await key(dialog.getByRole('button', { name: develop.close, exact: true }).last()); await expect(dialog).toHaveCount(0);
	await open(); preview = dialog.locator('[data-photo-develop-preview]'); await expect(preview).toHaveAttribute('data-state', 'ready');
	await expect(preview).toHaveAttribute('data-input-quality', 'original'); expect(await pixels()).toEqual(original);
	async function open() { await action(photoDevelopMenuLabel(locale), true); dialog = page.getByRole('dialog', { name: `${develop.title}: Cached input.png`, exact: true }); }
	async function action(label, photo = false) { await menu(app, copy.photoFileMenu); if (photo) await menu(app, copy.photoPhotoMenu); await key(app.getByRole('button', { name: label, exact: true })); }
	async function pixels() { return dialog.locator('[data-photo-develop-after]').evaluate(canvas => [...canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data]); }
	async function menu(root, label) { const summary = root.locator('summary').filter({ hasText: label }); const match = summary.filter({ hasText: new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`) }).first(); if (await match.evaluate(node => !node.parentElement.open)) await key(match); }
	async function key(locator) { await locator.focus(); await locator.press('Enter'); }
});
