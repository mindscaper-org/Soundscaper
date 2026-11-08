/* SPDX-License-Identifier: AGPL-3.0-only */

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import type { Download, Locator, Page } from '@playwright/test';
import { bundledLightscaperEditorCopyForLocale } from '../../src/common/i18n/lightscaper-editor-copy.ts';
import { photoDevelopCopy } from '../../src/common/i18n/lightscaper-develop-copy.ts';
import { photoDevelopMenuLabel } from '../../src/common/i18n/lightscaper-develop-menu-copy.ts';
import { photoDevelopSettingsCopy } from '../../src/common/i18n/lightscaper-develop-settings-copy.ts';
import { photoDevelopRepairSpotsCopy } from '../../src/common/i18n/lightscaper-develop-repair-spots-copy.ts';
import { photoPngExportCopy } from '../../src/common/i18n/lightscaper-photo-png-export-copy.ts';
import { photoJpegExportCopy } from '../../src/common/i18n/lightscaper-photo-jpeg-export-copy.ts';
import { photoPngExportMenuLabel } from '../../src/common/i18n/lightscaper-photo-png-export-menu-copy.ts';
import { photoJpegExportMenuLabel } from '../../src/common/i18n/lightscaper-photo-jpeg-export-menu-copy.ts';
import { photoRasterProfileCopy } from '../../src/common/i18n/lightscaper-photo-raster-profile-copy.ts';
import { photoRasterDepthCopy } from '../../src/common/i18n/lightscaper-photo-raster-depth-copy.ts';
import { imageExportTextCopy } from '../../src/common/i18n/image-export-text-copy.ts';
import type { PhotoRasterExportCopy } from '../../src/common/editor/ui/lightscaper/PhotoRasterExportDialog.tsx';
import { resolveBrowserProductTestUrl } from './helpers/browser-product-test-url.js';
import { editLightscaperDevelopNumberCurrentV1 } from './helpers/lightscaper-develop-numeric-keyboard-current.ts';
import { expect, test, installNativeImageHandoffRuntime, compileNativeImageHandoffScript } from './helpers/lightscaper-image-handoff-native-fixture.js';
import type { readRepairExportCustodyNativeV1 } from './helpers/lightscaper-repair-export-reference.ts';
import type { readManagedFallbackUiPhotoCurrentV1 } from './helpers/lightscaper-managed-fallback-ui-current.ts';
import { MATRIX_NAME, MATRIX_CAMERA, MATRIX_DEVELOPED, MATRIX_FORMATS, MATRIX_SIZES, MATRIX_SCOPES, MATRIX_SIDECARS,
	MATRIX_ROLES, matrixRole, matrixOriginalPng, matrixPixels, matrixSha256, inspectMatrixArtifact, decodeMatrixArtifact,
	type MatrixFormat, type MatrixSize } from './helpers/lightscaper-raster-export-matrix-current.ts';

type NativeObservation = Awaited<ReturnType<typeof readRepairExportCustodyNativeV1>>;
type FallbackObservation = Awaited<ReturnType<typeof readManagedFallbackUiPhotoCurrentV1>>;
type Photo = FallbackObservation['photo'];
const NATIVE_PROGRAM = '/__raster_matrix_native_custody.js', FALLBACK_PROGRAM = '/__raster_matrix_fallback_custody.js';

test('Current menu export matrix delivers all 40 PNG/JPEG sizing, EXIF and sidecar roles without changing the saved Photo or Original', async ({ page, browserName }) => {
	test.setTimeout(180_000);
	expect(test.info().config.workers).toBe(1); expect(test.info().retry).toBe(0); expect(test.info().project.retries).toBe(0);
	expect(MATRIX_ROLES).toHaveLength(40); expect(new Set(MATRIX_ROLES).size).toBe(40);
	const f = await fixture(page), rows: Record<string, unknown>[] = [], payloads = new Map<string, string>();
	let totalDownloads = 0;
	const countDownload = () => { totalDownloads++; }; page.on('download', countDownload);
	try {
		await f.author(); const saved = await f.observe(); f.immutable(saved);
		const photo = saved.photo, version = active(photo);
		expect(photo.schemaVersion).toBe(3); expect(version.develop.processVersion).toBe(3);
		if (version.develop.processVersion !== 3) throw new Error('The actual saved matrix recipe must be process3.');
		expect(version.develop.repairs.spots).toHaveLength(1); expect(version.develop.repairs.spots[0]?.mode).toBe('heal');
		expect(version.develop.effects.map(effect => effect.type)).toEqual(['develop-geometry-v1', 'tone-ladder-v1']);
		for (const format of MATRIX_FORMATS) {
			const words = format === 'png' ? photoPngExportCopy('en') : photoJpegExportCopy('en');
			const dialog = await f.openExport(format, words);
			await expect(dialog.getByRole('checkbox', { name: words.sidecar, exact: true })).not.toBeChecked();
			await expect(dialog.getByRole('checkbox', { name: words.outputSharpen, exact: true })).not.toBeChecked();
			await expect(dialog.getByRole('checkbox', { name: imageExportTextCopy('en').enabled, exact: true })).not.toBeChecked();
			await expect(dialog.getByRole('combobox', { name: photoRasterProfileCopy('en').label, exact: true })).toHaveValue('srgb');
			if (format === 'png') await expect(dialog.getByRole('combobox', { name: photoRasterDepthCopy('en').label, exact: true })).toHaveValue('8');
			try {
				for (const size of MATRIX_SIZES) for (const scope of MATRIX_SCOPES) for (const sidecar of MATRIX_SIDECARS) {
					const role = matrixRole(format, size, scope, sidecar);
					await test.step(role, async () => {
						const prefix = `${format}-${size.kind}-${scope}-${sidecar ? 'on' : 'off'}`;
						const name = `${prefix}-Matrix original.${format === 'png' ? 'png' : 'jpg'}`;
						await configure(dialog, words, size, scope, sidecar, `${prefix}-{name}`);
						const downloads: Download[] = [], popups: string[] = [];
						const receive = (download: Download) => { downloads.push(download); };
						const popup = (opened: Page) => { popups.push(opened.url()); };
						let failure: { value: unknown } | null = null;
						page.on('download', receive); page.on('popup', popup);
						try {
							await key(dialog.getByRole('button', { name: words.save, exact: true }));
							await expect(dialog.getByText(words.downloadStarted.replace('{name}', name), { exact: true })).toBeVisible();
							if (sidecar) await expect(dialog.getByText(words.sidecarSaved.replace('{name}', `${name}.lightscaper.json`), { exact: true })).toBeVisible();
							await expect(dialog.getByRole('button', { name: words.save, exact: true })).toBeEnabled();
							await expect(dialog.getByRole('alert')).toHaveCount(0);
							await expect.poll(() => downloads.length).toBe(sidecar ? 2 : 1);
							const image = downloads.find(download => download.suggestedFilename() === name);
							if (!image) throw new Error(`The actual ${role} raster download is missing.`);
							const bytes = await delivered(image), hashes = inspectMatrixArtifact(format, bytes, size, scope === 'capture');
							const pixels = await decodeMatrixArtifact(page, bytes, format, size), expected = matrixPixels(size);
							expect(pixels).toHaveLength(expected.length);
							// PNG is exact. Real JPEG grayscale quantization is bounded by the
							// existing repaired-raster tolerance, not a blanket lossy waiver.
							for (let index = 0; index < pixels.length; index++) {
								if (format === 'png' || index % 4 === 3) expect(pixels[index]).toBe(expected[index]);
								else expect(Math.abs(pixels[index]! - expected[index]!)).toBeLessThanOrEqual(8);
							}
							const payloadKey = `${format}/${size.kind}`, prior = payloads.get(payloadKey);
							if (prior === undefined) payloads.set(payloadKey, hashes.payloadSha256);
							else expect(hashes.payloadSha256).toBe(prior);
							let sidecarSha256: string | null = null;
							if (sidecar) {
								const json = downloads.find(download => download.suggestedFilename() === `${name}.lightscaper.json`);
								if (!json) throw new Error(`The actual ${role} sidecar download is missing.`);
								const jsonBytes = await delivered(json); expect(jsonBytes.length).toBeLessThanOrEqual(16_384);
								expect(JSON.parse(jsonBytes.toString('utf8')) as unknown).toEqual(expectedSidecar(photo));
								sidecarSha256 = matrixSha256(jsonBytes);
							}
							rows.push({ role, browser: browserName, storage: saved.storage, width: size.width, height: size.height,
								fileName: name, byteLength: bytes.length, ...hashes, sidecarSha256,
								decodedSha256: matrixSha256(Uint8Array.from(pixels)), codec: 'native-browser', pixelTolerance: format === 'png' ? 0 : 8 });
						} catch (error) { failure = { value: error }; }
						finally { page.off('download', receive); page.off('popup', popup); }
						if (failure) await Promise.allSettled([attachDeliveryFailure(page, role, downloads, popups)]);
						const deleted = await Promise.allSettled(downloads.map(download => download.delete()));
						if (failure) throw failure.value;
						for (const result of deleted) if (result.status === 'rejected') throw result.reason;
					});
				}
			} finally { await f.closeExport(dialog, words); }
			expect(await f.observe()).toEqual(saved);
		}
		expect(rows.map(row => row.role)).toEqual(MATRIX_ROLES); expect(totalDownloads).toBe(60);
		expect(payloads.size).toBe(10); expect(await f.observe()).toEqual(saved);
		await page.reload(); await expect(f.app).toBeVisible(); await f.showLibrary();
		await expect(f.card).toHaveCount(1); await expect(f.library).toHaveAttribute('aria-busy', 'false');
		expect(await f.card.getAttribute('data-photo-id')).toBe(f.photoId); expect(await f.observe()).toEqual(saved);
		expect(f.errors).toEqual([]);
	} finally {
		page.off('download', countDownload);
		await test.info().attach('raster-export-40-role-coverage.json', { contentType: 'application/json', body: Buffer.from(JSON.stringify({
			browser: browserName, expectedRoles: MATRIX_ROLES, completed: rows.length, nativeDownloads: totalDownloads, roles: rows,
		}, null, 2)) });
	}
});

async function configure(dialog: Locator, copy: PhotoRasterExportCopy, size: MatrixSize,
	scope: typeof MATRIX_SCOPES[number], sidecar: boolean, filename: string): Promise<void> {
	await dialog.getByRole('combobox', { name: copy.outputSize, exact: true }).selectOption(size.kind);
	for (const [label, value] of size.fields) {
		const input = dialog.getByRole('spinbutton', { name: copy[label], exact: true });
		await input.fill(value); await input.press('Tab'); await expect(input).toHaveValue(value);
		expect(await input.evaluate(element => {
			if (!(element instanceof HTMLInputElement)) throw new TypeError('Sizing requires a genuine native input.');
			return element.validity.valid;
		})).toBe(true);
	}
	if (['fit', 'long-edge', 'megapixels'].includes(size.kind)) {
		await dialog.getByRole('checkbox', { name: copy.allowUpscale, exact: true }).setChecked(size.upscale);
	}
	if (size.kind !== 'original') await dialog.getByRole('combobox', { name: copy.resample, exact: true }).selectOption('nearest');
	await dialog.getByRole('combobox', { name: copy.metadata, exact: true }).selectOption(scope);
	await dialog.getByRole('checkbox', { name: copy.sidecar, exact: true }).setChecked(sidecar);
	await dialog.getByRole('textbox', { name: copy.filenameTemplate, exact: true }).fill(filename);
}

async function fixture(page: Page) {
	await installNativeImageHandoffRuntime(page);
	// Choose the existing genuine browser-download destination. Encoding and
	// delivery still use the product owners, native Blob and native anchor.
	await page.addInitScript(() => {
		Object.defineProperty(window, 'showSaveFilePicker', { configurable: true, value: undefined });
		// Passive scalar witness only: the native event/default action, Blob URL
		// and save/codec owners are never intercepted or replaced.
		const clicks: Record<string, unknown>[] = [], state = { clicks, overflow: 0 };
		Object.defineProperty(globalThis, '__lightscaperRasterMatrixDownloadWitness', { value: state });
		window.addEventListener('click', event => {
			const anchor = event.target;
			if (!(anchor instanceof HTMLAnchorElement) || !anchor.download) return;
			if (clicks.length >= 128) { state.overflow++; return; }
			clicks.push({ name: anchor.download, url: anchor.href, connected: anchor.isConnected,
				isTrusted: event.isTrusted, defaultPrevented: event.defaultPrevented, at: performance.now(),
				userActive: navigator.userActivation?.isActive ?? null, everActive: navigator.userActivation?.hasBeenActive ?? null });
		}, true);
	});
	for (const [pathname, entry] of [[NATIVE_PROGRAM, './helpers/lightscaper-repair-export-reference.ts'],
		[FALLBACK_PROGRAM, './helpers/lightscaper-managed-fallback-ui-current.ts']] as const) {
		const program = await compileNativeImageHandoffScript(pathname.slice(1), fileURLToPath(new URL(entry, import.meta.url)));
		expect(program.assets).toEqual([]);
		await page.route(`**${pathname}`, route => route.fulfill({ contentType: 'text/javascript', body: program.source }));
	}
	const errors: string[] = []; page.on('pageerror', error => { errors.push(error.message); });
	const copy = bundledLightscaperEditorCopyForLocale('en'), words = photoDevelopCopy('en');
	await page.goto(resolveBrowserProductTestUrl('/lightscaper/en/'));
	const app = page.getByRole('region', { name: 'Lightscaper', exact: true }); await expect(app).toBeVisible();
	const opfs = await page.evaluate(() => typeof navigator.storage?.getDirectory === 'function');
	await menu(copy.photoFileMenu); await key(app.getByRole('button', { name: copy.photoImportPhotos, exact: true }));
	const importer = page.getByRole('dialog', { name: copy.photoImportPhotos, exact: true }), original = matrixOriginalPng();
	expect(original.length).toBeLessThanOrEqual(4096);
	await importer.getByLabel(copy.photoChooseFiles, { exact: true }).setInputFiles({ name: MATRIX_NAME, mimeType: 'image/png', buffer: original });
	await key(importer.getByRole('button', { name: copy.photoImportAction, exact: true })); await expect(importer).toHaveCount(0);
	const library = app.locator('[data-photo-library]'), card = library.locator('[data-photo-id]');
	await expect(card).toHaveCount(1); await expect(library).toHaveAttribute('aria-busy', 'false');
	const rawPhotoId = await card.getAttribute('data-photo-id'); if (!rawPhotoId) throw new Error('The actual matrix Photo ID is missing.');
	const photoId: string = rawPhotoId;
	const initial = await observe(); expect(initial.bodySha256).toBe(matrixSha256(original)); expect(initial.bodyByteLength).toBe(original.length);
	expect(initial.photo.extractedMetadata?.exif?.cameraMake).toBe(MATRIX_CAMERA);
	await key(card);
	return { app, library, card, photoId, errors, observe, author, openExport, closeExport, immutable,
		showLibrary: async () => { await menu(copy.photoViewMenu); await key(app.getByRole('button', { name: copy.photoShowLibrary, exact: true })); } };

	async function menu(label: string) {
		const summary = app.getByRole('navigation').locator('summary').filter({ hasText: new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}$`, 'u') });
		if (await summary.evaluate(element => !element.parentElement?.hasAttribute('open'))) await key(summary);
	}
	async function author() {
		await menu(copy.photoFileMenu); await menu(copy.photoPhotoMenu); await key(app.getByRole('button', { name: photoDevelopMenuLabel('en'), exact: true }));
		const develop = page.getByRole('dialog', { name: `${words.title}: ${MATRIX_NAME}`, exact: true }); await expect(develop).toBeVisible();
		const preview = develop.locator('[data-photo-develop-preview]'); await expect(preview).toHaveAttribute('data-state', 'ready');
		const settings = photoDevelopSettingsCopy('en', 'current3'), repairs = photoDevelopRepairSpotsCopy('en');
		await key(develop.getByText(settings.menu, { exact: true })); await key(develop.getByRole('button', { name: repairs.menu, exact: true }));
		const repair = page.getByRole('dialog', { name: repairs.title, exact: true }); await expect(repair).toBeVisible();
		await expect(repair.locator('[data-photo-repair-original]')).toHaveAttribute('data-state', 'ready');
		await repair.getByRole('combobox', { name: repairs.mode, exact: true }).selectOption('heal');
		for (const [label, value] of [['targetX', '.7'], ['targetY', '.5'], ['sourceX', '.2'], ['sourceY', '.5'],
			['radius', '.15'], ['feather', '0'], ['opacity', '1']] as const) {
			await editLightscaperDevelopNumberCurrentV1(repair.getByRole('spinbutton', { name: repairs[label], exact: true }), value);
		}
		await key(repair.getByRole('button', { name: repairs.add, exact: true }));
		await key(repair.getByRole('button', { name: repairs.apply, exact: true })); await expect(repair).toHaveCount(0);
		await develop.getByRole('combobox', { name: words.choose, exact: true }).selectOption('develop-geometry-v1');
		await key(develop.getByRole('button', { name: words.add, exact: true }));
		for (const [label, value] of [['CropWidth', '.2'], ['CropHeight', '.2'], ['CropX', '.6'], ['CropY', '.4']] as const) {
			await editLightscaperDevelopNumberCurrentV1(develop.getByRole('spinbutton', {
				name: `${words.shared.videoEffectExactValue}: ${words.shared[`videoEffectParam${label}`]}`, exact: true }), value);
		}
		await develop.getByRole('combobox', { name: `${words.shared.videoEffectExactValue}: ${words.shared.videoEffectParamFlipHorizontal}`, exact: true }).selectOption('1');
		await develop.getByRole('combobox', { name: words.choose, exact: true }).selectOption('tone-ladder-v1');
		await key(develop.getByRole('button', { name: words.add, exact: true }));
		await editLightscaperDevelopNumberCurrentV1(develop.getByRole('spinbutton', {
			name: `${words.shared.videoEffectExactValue}: ${words.shared.videoEffectParamExposure}`, exact: true }), '1');
		await expect(preview).toHaveAttribute('data-state', 'ready');
		await expect.poll(() => develop.getByRole('img', { name: words.after, exact: true }).evaluate(element => {
			if (!(element instanceof HTMLCanvasElement)) throw new TypeError('Actual Develop output is not a native canvas.');
			const context = element.getContext('2d'); if (!context) throw new Error('Actual Develop readback is unavailable.');
			return [element.width, element.height, ...context.getImageData(0, 0, element.width, element.height).data];
		})).toEqual([2, 1, ...MATRIX_DEVELOPED]);
		await key(develop.getByRole('button', { name: words.save, exact: true }));
		await expect(develop.locator('[data-photo-develop-ack]')).toBeVisible();
		await expect(develop.getByRole('button', { name: words.save, exact: true })).toBeDisabled();
		await key(develop.getByRole('button', { name: words.close, exact: true }).last()); await expect(develop).toHaveCount(0);
	}
	async function openExport(format: MatrixFormat, words: PhotoRasterExportCopy) {
		await menu(copy.photoFileMenu); await key(app.getByRole('button', {
			name: format === 'png' ? photoPngExportMenuLabel('en') : photoJpegExportMenuLabel('en'), exact: true }));
		const dialog = page.getByRole('dialog', { name: words.title, exact: true }); await expect(dialog).toBeVisible();
		await expect(dialog.getByRole('button', { name: words.save, exact: true })).toBeEnabled(); return dialog;
	}
	async function closeExport(dialog: Locator, words: PhotoRasterExportCopy) {
		await key(dialog.getByRole('button', { name: words.close, exact: true }).last()); await expect(dialog).toHaveCount(0);
	}
	async function observe() {
		if (opfs) {
			const value: NativeObservation = await page.evaluate(async ({ pathname, photoId }) => {
				const owner = await import(new URL(pathname, location.href).href) as typeof import('./helpers/lightscaper-repair-export-reference.ts');
				return owner.readRepairExportCustodyNativeV1([photoId], async () => {
					const witness = Reflect.get(globalThis, '__assertNativeOpfsWorkerExecution') as unknown;
					if (typeof witness !== 'function') throw new Error('The actual native OPFS witness is missing.');
					await (witness as () => Promise<void>)();
				});
			}, { pathname: NATIVE_PROGRAM, photoId });
			const row = value.photos[0]; if (!row) throw new Error('The actual native matrix Photo is missing.');
			return { storage: 'opfs' as const, namespace: value.namespace, photo: row.photo,
				bodySha256: row.original.sha256, bodyByteLength: row.original.byteLength, custody: row.original };
		}
		const value: FallbackObservation = await page.evaluate(async ({ pathname, photoId }) => {
			const owner = await import(new URL(pathname, location.href).href) as typeof import('./helpers/lightscaper-managed-fallback-ui-current.ts');
			return owner.readManagedFallbackUiPhotoCurrentV1(photoId);
		}, { pathname: FALLBACK_PROGRAM, photoId });
		return { storage: value.storage, namespace: value.namespace, photo: value.photo,
			bodySha256: value.bodySha256, bodyByteLength: value.bodyByteLength, custody: value.custody };
	}
	function immutable(value: Awaited<ReturnType<typeof observe>>) {
		expect(value.namespace).toBe(initial.namespace); expect(value.storage).toBe(initial.storage);
		expect(value.photo.original).toEqual(initial.photo.original); expect(value.custody).toEqual(initial.custody);
		expect(value.bodySha256).toBe(initial.bodySha256); expect(value.bodyByteLength).toBe(initial.bodyByteLength);
		expect(value.photo.metadata).toEqual(initial.photo.metadata); expect(value.photo.extractedMetadata).toEqual(initial.photo.extractedMetadata);
	}
}

async function key(control: Locator): Promise<void> {
	await expect(control).toBeEnabled(); await control.focus(); await expect(control).toBeFocused(); await control.press('Enter');
}
async function delivered(download: Download): Promise<Buffer> {
	expect(await download.failure()).toBeNull(); const path = await download.path();
	if (path === null) throw new Error('The actual completed download has no native path.'); return readFile(path);
}
async function attachDeliveryFailure(page: Page, role: string, downloads: readonly Download[], popups: readonly string[]): Promise<void> {
	const nativeDownloads = await Promise.all(downloads.map(async download => ({
		name: download.suggestedFilename(), url: download.url(), failure: await download.failure(),
	})));
	const witness: unknown = await page.evaluate(() => Reflect.get(globalThis, '__lightscaperRasterMatrixDownloadWitness') as unknown);
	await test.info().attach('raster-export-delivery-failure.json', { contentType: 'application/json', body: Buffer.from(JSON.stringify({
		role, nativeDownloads, witness, popups, pages: page.context().pages().map(opened => ({ url: opened.url(), closed: opened.isClosed() })),
	}, null, 2)) });
}
function active(photo: Photo) {
	const version = photo.versions.find(value => value.id === photo.activeVersionId);
	if (!version) throw new Error('The actual saved matrix version is missing.'); return version;
}
function expectedSidecar(photo: Photo) {
	const version = active(photo);
	return { schemaFamily: 'lightscaper', schemaVersion: 2, kind: 'photo-export-sidecar', photoSchemaVersion: 3,
		binding: { catalogId: photo.catalogId, photoId: photo.id, revision: photo.revision, activeVersionId: photo.activeVersionId },
		original: { fileName: photo.original.name, contentSha256: photo.original.contentSha256, byteLength: photo.original.byteLength },
		version: { id: version.id, kind: version.kind, name: version.name, createdAt: version.createdAt, develop: version.develop },
		metadata: photo.metadata, extractedMetadata: photo.extractedMetadata };
}
