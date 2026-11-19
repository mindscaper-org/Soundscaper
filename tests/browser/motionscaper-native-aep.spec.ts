/* SPDX-License-Identifier: AGPL-3.0-only */
import { readFile } from 'node:fs/promises';
import type { Page } from '@playwright/test';
import { expect, test } from './helpers/browser-coverage-fixture.js';
import { ordinaryBrowserProductSitePlan } from '../../scripts/lib/browser-product-site-plan.mjs';
import { nativeAepFixture, aepImageFixture } from '../helpers/motionscaper-aep-fixture.ts';
import { importMotionscaperArchive } from '../../src/motionscaper/editor-scape.ts';
import type { MotionscaperProject } from '../../src/common/editor/motion-project-types.ts';
test.use({ baseURL: ordinaryBrowserProductSitePlan().sites.find(site => site.productId === 'motionscaper')!.origin });
async function menu(page: Page, item: string, top = 'File') {
	await page.getByRole('menuitem', { name: top, exact: true }).click(); await page.getByRole('menuitem', { name: item, exact: true }).click();
}
test('native AEP menu requires review, renders a solid and retains source bytes through Save and reopen', async ({ page }) => {
	const bytes = nativeAepFixture(); await page.goto('/embed/en/'); await menu(page, 'Import After Effects Project');
	const dialog = page.getByRole('dialog', { name: 'Import After Effects Project', exact: true });
	await dialog.getByLabel('After Effects project file', { exact: true }).setInputFiles({ name: 'Native.aep', mimeType: 'application/octet-stream', buffer: Buffer.from(bytes) });
	await dialog.getByRole('button', { name: 'Review Import', exact: true }).click();
	const report = dialog.getByRole('region', { name: 'Conversion report', exact: true }); await expect(report).toContainText('Native AEP import decoded 2 compositions');
	await expect(report.getByRole('button', { name: 'Import New Project', exact: true })).toBeDisabled();
	const download = page.waitForEvent('download'); await dialog.getByRole('button', { name: 'Download Original Project', exact: true }).click();
	const original = await download; expect(await readFile((await original.path())!)).toEqual(Buffer.from(bytes));
	await report.getByRole('checkbox').check(); await report.getByRole('button', { name: 'Import New Project', exact: true }).click(); await expect(dialog).toHaveCount(0);
	await expect(page.locator('[data-motion-project-title]')).toHaveText('Native.aep');
	await menu(page, 'Composition Preview', 'View'); const preview = page.getByRole('dialog', { name: 'Composition Preview', exact: true }), canvas = preview.locator('canvas');
	await expect(canvas).toHaveAttribute('data-motion-frame', '0');
	const pixel = await canvas.evaluate((element: HTMLCanvasElement) => Array.from(element.getContext('2d')!.getImageData(32, 24, 1, 1).data));
	expect(pixel[0]).toBeGreaterThanOrEqual(63); expect(pixel[0]).toBeLessThanOrEqual(65); expect(pixel[3]).toBe(255);
	await preview.getByRole('button', { name: 'Close', exact: true }).last().click(); await menu(page, 'Save');
	await expect(page.locator('[data-motion-save-status]')).toHaveText('Saved on this device'); await page.reload(); await menu(page, 'Project Library');
	await page.getByRole('button', { name: 'Native.aep', exact: true }).click(); await expect(page.locator('[data-motion-project-title]')).toHaveText('Native.aep');
});
test('native import rejects malformed AEPX and opens the pinned XML project without scripts', async ({ page }) => {
	await page.goto('/embed/en/'); await menu(page, 'Import After Effects Project');
	const dialog = page.getByRole('dialog', { name: 'Import After Effects Project', exact: true });
	await dialog.getByLabel('After Effects project file', { exact: true }).setInputFiles({ name: 'Broken.aepx', mimeType: 'application/xml', buffer: Buffer.from('<!DOCTYPE x><AfterEffectsProject/>') });
	await dialog.getByRole('button', { name: 'Review Import', exact: true }).click(); await expect(dialog.getByRole('alert')).toContainText('DOCTYPE');
	await expect(dialog.getByRole('region', { name: 'Conversion report', exact: true })).toHaveCount(0);
	await dialog.getByLabel('After Effects project file', { exact: true }).setInputFiles(new URL('../fixtures/native-aep/aepx-pair.aepx', import.meta.url).pathname);
	await dialog.getByRole('button', { name: 'Review Import', exact: true }).click();
	await expect(dialog.getByRole('region', { name: 'Conversion report', exact: true })).toContainText('Native AEPX import decoded 6 compositions');
	await expect(dialog.getByLabel('Original font face file — TimesNewRomanPSMT')).toBeVisible();
	await dialog.getByRole('button', { name: 'Close', exact: true }).last().click(); await expect(page.locator('[data-motion-project-title]')).toHaveCount(0);
});
for (const kind of ['media', 'font'] as const) test(`native AEP ${kind} selection invalidates review and survives portable Save Copy`, async ({ page }) => {
	const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLttAAAAABJRU5ErkJggg==', 'base64');
	const bytes = kind === 'media' ? aepImageFixture() : await readFile(new URL('../fixtures/native-aep/aepx-pair.aep', import.meta.url));
	await page.goto('/embed/en/'); await menu(page, 'Import After Effects Project'); const dialog = page.getByRole('dialog', { name: 'Import After Effects Project', exact: true });
	await dialog.getByLabel('After Effects project file', { exact: true }).setInputFiles({ name: 'Selected.aep', mimeType: 'application/octet-stream', buffer: Buffer.from(bytes) });
	await dialog.getByRole('button', { name: 'Review Import', exact: true }).click(); const report = dialog.getByRole('region', { name: 'Conversion report', exact: true }); await report.getByRole('checkbox').check();
	if (kind === 'media') await dialog.getByLabel('Original media — Pixel.png').setInputFiles({ name: 'Pixel.png', mimeType: 'image/png', buffer: png });
	else await dialog.getByLabel('Original font face file — TimesNewRomanPSMT').setInputFiles(new URL('../fixtures/motionscaper-fonts/arabic.woff2', import.meta.url).pathname);
	await expect(report).toHaveCount(0); await dialog.getByRole('button', { name: 'Review Import', exact: true }).click();
	await expect(report.getByRole('button', { name: 'Import New Project', exact: true })).toBeDisabled(); await report.getByRole('checkbox').check(); await report.getByRole('button', { name: 'Import New Project', exact: true }).click(); await expect(dialog).toHaveCount(0);
	const pending = page.waitForEvent('download'); await menu(page, 'Save Copy'); const downloaded = await pending, archive = new Blob([new Uint8Array(await readFile((await downloaded.path())!))]);
	let saved: MotionscaperProject | undefined; const bodies = new Map<string, Uint8Array[]>();
	await importMotionscaperArchive(archive, () => ({ writeAssetChunk: (asset, bytes) => { bodies.set(asset.id, [...(bodies.get(asset.id) ?? []), bytes.slice()]); return Promise.resolve(); }, finishAsset: () => Promise.resolve(), commit: project => { saved = project; return Promise.resolve(); }, rollback: () => Promise.resolve() }));
	expect(saved!.assets.some(asset => asset.kind === (kind === 'media' ? 'image' : 'font'))).toBe(true);
	const source = saved!.assets.find(asset => asset.id === saved!.nativeImport!.sourceAssetId)!; expect(Buffer.concat(bodies.get(source.id)!)).toEqual(Buffer.from(bytes));
	const layers = saved!.compositions.flatMap(comp => comp.layers); expect(layers.some(layer => layer.kind === (kind === 'media' ? 'image' : 'text'))).toBe(true);
});
