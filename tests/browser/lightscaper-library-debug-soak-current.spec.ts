/* SPDX-License-Identifier: AGPL-3.0-only */
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { expect, test } from './helpers/browser-coverage-fixture.js';
import { resolveBrowserProductTestUrl } from './helpers/browser-product-test-url.js';
import { bundledLightscaperEditorCopyForLocale } from '../../src/common/i18n/lightscaper-editor-copy.ts';
import { rawDngFixtureV1 } from '../helpers/lightscaper-raw-dng-current-fixture.ts';
import { deflateSync } from 'node:zlib';
import { pngChunk } from '../helpers/image-metadata-fixtures.ts';

const coverage: Parameters<typeof test.use>[0] & Readonly<{ browserCoverage: boolean }> = { browserCoverage: false };
test.use(coverage);
for (const locale of ['en', 'de']) test(`Menu-only library debug soak imports tiny PNG+RAW and verifies three real browser close/reopen/export rounds (${locale})`, async ({ page }) => {
	test.setTimeout(60_000);
	const manifest = JSON.parse(await readFile(new URL('../../config/lightscaper-libraw-runtime-manifest.json', import.meta.url), 'utf8')) as { runtime: { path: string; url: string; sha256: string } };
	const wasm = await readFile(new URL(`../../${manifest.runtime.path}`, import.meta.url)); expect(createHash('sha256').update(wasm).digest('hex')).toBe(manifest.runtime.sha256);
	await page.route(manifest.runtime.url, route => route.fulfill({ status: 200, headers: { 'content-type': 'application/wasm', 'access-control-allow-origin': '*', 'cross-origin-resource-policy': 'cross-origin' }, body: wasm }));
	const raw = rawDngFixtureV1().bytes, png = tinyPng();
	const errors: string[] = []; page.on('pageerror', error => { errors.push(error.message); });
	await page.goto(resolveBrowserProductTestUrl(`/lightscaper/${locale}/`));
	const copy = bundledLightscaperEditorCopyForLocale(locale), label = locale === 'de' ? 'Bibliotheks-Diagnoselauf' : 'Library debug soak';
	await expect(page.getByRole('dialog')).toHaveCount(0); await expect(page.locator('[data-photo-debug-soak-report]')).toHaveCount(0);
	await page.getByRole('navigation').getByText(copy.photoFileMenu, { exact: true }).click();
	await page.getByRole('button', { name: label, exact: true }).click();
	const dialog = page.getByRole('dialog', { name: label, exact: true }); await expect(dialog).toBeVisible();
	await dialog.locator('input[type=file]').setInputFiles([{ name: 'Owned tiny.png', mimeType: 'image/png', buffer: Buffer.from(png) }, { name: 'Owned tiny.dng', mimeType: 'image/x-adobe-dng', buffer: Buffer.from(raw) }]);
	await dialog.getByRole('button', { name: locale === 'de' ? '3 Runden starten' : 'Run 3 rounds', exact: true }).click();
	await expect(dialog.locator('[data-photo-debug-soak-report]')).toHaveAttribute('data-status', 'complete', { timeout: 45_000 });
	const report = JSON.parse(await dialog.locator('[data-photo-debug-soak-report]').inputValue()) as {
		iterations: number; importedPhotos: number; outputs: { pixelsSha256: string; sha256: string; width: number; height: number }[];
		originals: { sha256: string }[]; owners: { activeSessions: number; activeExports: number; joined: boolean }; memory: { kind: string };
	};
	expect(report.iterations).toBe(3); expect(report.importedPhotos).toBe(6); expect(report.outputs).toHaveLength(6);
	const expected = new Set([png, raw].map(bytes => createHash('sha256').update(bytes).digest('hex')));
	for (const original of report.originals) expect(expected.has(original.sha256)).toBe(true);
	for (const output of report.outputs) { expect(output.width).toBeGreaterThan(0); expect(output.height).toBeGreaterThan(0); expect(output.sha256).toMatch(/^[a-f0-9]{64}$/u); expect(output.pixelsSha256).toMatch(/^[a-f0-9]{64}$/u); }
	expect(report.owners.activeSessions).toBe(0); expect(report.owners.activeExports).toBe(0); expect(report.owners.joined).toBe(true);
	expect(['browser-js-heap', 'unavailable']).toContain(report.memory.kind);
	await dialog.getByRole('button', { name: locale === 'de' ? 'Schließen' : 'Close', exact: true }).last().click(); await expect(dialog).toHaveCount(0);
	await showLibrary(); await expect(page.locator('[data-photo-id]')).toHaveCount(6);
	await page.reload(); await showLibrary(); await expect(page.locator('[data-photo-id]')).toHaveCount(6); expect(errors).toEqual([]);
	async function showLibrary(): Promise<void> {
		await page.getByRole('navigation').getByText(copy.photoViewMenu, { exact: true }).click();
		await page.getByRole('button', { name: copy.photoShowLibrary, exact: true }).click();
	}

});

function tinyPng(): Uint8Array<ArrayBuffer> {
	const header = Buffer.alloc(13); header.writeUInt32BE(2, 0); header.writeUInt32BE(2, 4); header.set([8, 6], 8);
	const rows = Uint8Array.from([0, 255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 0, 255, 255, 255, 255, 255, 255]);
	return new Uint8Array(Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), pngChunk('IHDR', header),
		pngChunk('IDAT', new Uint8Array(deflateSync(rows))), pngChunk('IEND', new Uint8Array())]));
}
