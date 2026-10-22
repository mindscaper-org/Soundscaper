/* SPDX-License-Identifier: AGPL-3.0-only */
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseNestedCommandAction, collectClientErrors, registerAudioEditorHooks, stubStorageEstimate } from './audio-editor-test-helpers.js';
import { installDesktopSpeedWarmupManifest } from './helpers/desktop-speed-warmup-fixture.js';
import { installCorridorKeyFixture } from './helpers/corridorkey-fixture.js';
import { FRAMESCAPER_DATABASE_NAME } from './helpers/editor-databases.js';
import { createVideoSource } from '../../src/common/editor/project-media-factory.ts';
import { createFramescaperProject } from '../../src/framescaper/editor-project.ts';
import { createFramescaperProjectStore } from '../../src/framescaper/editor-project-store.ts';
import { createFramescaperScapeNativeRuntime } from '../../src/framescaper/editor-scape-native.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE as PROFILE } from '../../src/framescaper/editor-project-runtime-profile.ts';

test.use({ browserCoverage: false });
const ROOT = '/__corridorkey_decode__';

test('full-raster keying decode reads the presented source ordinal after sequential and reverse seeks', async ({ page }) => {
	const bundle = await build({ entryPoints: [fileURLToPath(new URL('../../src/common/editor/controller/assistance/internal/video/local-assistance-video-keying-decoder.ts', import.meta.url))],
		bundle: true, write: false, format: 'esm', platform: 'browser' });
	const media = await readFile(new URL('./fixtures/corridorkey/cfr-colors.webm', import.meta.url));
	await page.route(`${ROOT}/**`, async (route) => {
		const url = route.request().url();
		await route.fulfill(url.endsWith('.webm') ? { contentType: 'video/webm', body: media }
			: url.endsWith('index.html') ? { contentType: 'text/html', body: '<!doctype html><title>Keying frame decode</title>' }
				: { contentType: 'text/javascript', body: bundle.outputFiles[0].text });
	});
	await page.goto(`${ROOT}/index.html`);
	const samples = await page.evaluate(async (root) => {
		const { createFullRasterKeyingVideoDecoder } = await import(`${root}/entry.js`);
		const source = await fetch(`${root}/fixture.webm`).then((response) => response.blob());
		const signal = new AbortController().signal;
		const decoder = await createFullRasterKeyingVideoDecoder(source, { width: 1_280, height: 720,
			frameRate: { num: 4, den: 1 } }, signal);
		const values = [];
		try {
			for (const timestamp of [0.125, 0.375, 0.625, 0.875, 0.125, 0.625]) {
				const rgba = await decoder.capture(timestamp, signal);
				values.push({ timestamp, bytes: rgba.byteLength, rgba: [...rgba.slice(0, 4)] });
			}
		} finally { decoder.dispose(); }
		return values;
	}, ROOT);
	expect(samples.every(({ bytes }) => bytes === 1_280 * 720 * 4)).toBe(true);
	for (const [index, expected] of [[255, 0, 0], [0, 255, 0], [0, 0, 255], [255, 255, 255], [255, 0, 0], [0, 0, 255]].entries()) {
		for (let channel = 0; channel < 3; channel += 1) expect(Math.abs(samples[index].rgba[channel] - expected[channel])).toBeLessThanOrEqual(4);
		expect(samples[index].rgba[3]).toBe(255);
	}
});

test('the installed desktop tool keys the full stored source and admits one undoable transparent derivative', async ({ page }) => {
	await stubStorageEstimate(page, { usage: 1024, quota: 2 * 1024 ** 3 });
	await installCorridorKeyFixture(page);
	const errors = collectClientErrors(page);
	const editor = await bootEditor(page, '/framescaper/embed/en/');
	const archive = await keyingProjectArchive();
	await editor.locator('[data-aup4-input]').setInputFiles({ name: 'Keying.fscape', mimeType: 'application/zip', buffer: archive });
	await expect(editor).toHaveAttribute('data-project-id', 'corridorkey-browser');
	await editor.getByRole('group', { name: 'Video clip: chosen', exact: true }).press('Enter');
	await chooseNestedCommandAction(page, editor, 'Effect', ['Video effects', 'CorridorKey 2.0']);
	const dialog = page.getByRole('dialog', { name: 'CorridorKey 2.0', exact: true });
	await dialog.getByRole('button', { name: 'Key selected clip', exact: true }).click();
	await expect(dialog).toBeHidden({ timeout: 30_000 });
	await expect.poll(() => storedKeyingProject(page)).toMatchObject({ chosen: { sourceInFrame: 1, sourceFrameCount: 2 },
		other: { sourceId: 'corridorkey-original' }, keyed: { sourceFrameCount: 4, characteristics: { hasAlpha: true, alphaMode: 'straight' } } });
	const accepted = await storedKeyingProject(page); expect(accepted.chosen.sourceId).toBe(accepted.keyed.id);
	const video = editor.locator('[data-video-preview-clip]').first();
	await expect.poll(() => video.evaluate((element) => element.readyState)).toBeGreaterThan(1);
	const alpha = await video.evaluate((element) => {
		const canvas = document.createElement('canvas'); canvas.width = element.videoWidth; canvas.height = element.videoHeight;
		const context = canvas.getContext('2d'); context.drawImage(element, 0, 0);
		return [100, 600, 1000].map((x) => context.getImageData(x, 100, 1, 1).data[3]);
	});
	expect(alpha[0]).toBe(255); expect(Math.abs(alpha[1] - 128)).toBeLessThanOrEqual(1); expect(alpha[2]).toBe(0);
	await editor.getByRole('button', { name: 'Undo', exact: true }).click();
	await expect.poll(() => storedKeyingProject(page)).toMatchObject({ chosen: { sourceId: 'corridorkey-original' } });
	await editor.getByRole('button', { name: 'Redo', exact: true }).click();
	await expect.poll(() => storedKeyingProject(page)).toMatchObject({ chosen: { sourceId: accepted.keyed.id } });
	const fixture = await page.evaluate(() => globalThis.__corridorKeyFixture);
	expect(fixture.inputFrames).toBe(4); expect(fixture.fence).toMatchObject({ sourceStartFrame: 0, sourceEndFrame: 4 });
	expect(fixture.events[0]).toBe('encoder-preflight'); expect(fixture.events.at(-1)).toBe('release');
	expect(errors).toEqual([]);
});

async function keyingProjectArchive() {
	const bytes = await readFile(new URL('./fixtures/corridorkey/cfr-colors.webm', import.meta.url));
	const source = createVideoSource({ id: 'corridorkey-original', storageKey: 'corridorkey-original', name: 'Original colors',
		mimeType: 'video/webm', contentSha256: createHash('sha256').update(bytes).digest('hex'), frameRate: { num: 4, den: 1 },
		sampleRate: 48000, sourceFrameCount: 4, sampleFrameCount: 48000, width: 1280, height: 720 });
	const project = createFramescaperProject(PROFILE, { id: 'corridorkey-browser', sources: [source],
		clips: ['chosen', 'other'].map((id, index) => ({ kind: 'video', id, title: id, sourceId: source.id,
			sequenceId: 'main', sequenceStartFrame: index * 15, sequenceFrameCount: 15, sourceInFrame: index === 0 ? 1 : 0,
			sourceFrameCount: 2, retimeMap: null })),
		tracks: [{ id: 'pictures', type: 'video', clipIds: ['chosen', 'other'] }],
		sequences: [{ id: 'main', rate: { num: 30, den: 1 }, trackIds: ['pictures'] }], primarySequenceId: 'main' });
	const store = createFramescaperProjectStore(PROFILE, { indexedDB: null, preferOpfs: false });
	try {
		await store.writeMediaAsset(source.storageKey, new Blob([bytes], { type: 'video/webm' }), { name: source.name, mimeType: 'video/webm' });
		return Buffer.from(await (await createFramescaperScapeNativeRuntime(PROFILE).exportScapeProject(project, store)).blob.arrayBuffer());
	} finally { await store.close(); }
}
async function storedKeyingProject(page) {
	return page.evaluate(async (name) => {
		const result = (request) => new Promise((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
		const database = await result(indexedDB.open(name));
		try {
			const project = await result(database.transaction('projects', 'readonly').objectStore('projects').get('corridorkey-browser'));
			return { chosen: project.clips.find(({ id }) => id === 'chosen'), other: project.clips.find(({ id }) => id === 'other'),
				keyed: project.sources.find(({ id }) => id !== 'corridorkey-original') ?? null };
		} finally { database.close(); }
	}, FRAMESCAPER_DATABASE_NAME);
}

test.describe('CorridorKey menu-only model availability', () => {
	registerAudioEditorHooks();
	test('opens the dedicated tool and reports an unoffered model without any install or inference', async ({ page }) => {
		await stubStorageEstimate(page, { usage: 1_024, quota: 2 * 1_024 ** 3 });
		await installDesktopSpeedWarmupManifest(page);
		await page.addInitScript(() => {
			let installs = 0;
			const unavailable = async () => { installs += 1; throw new Error('The model is not offered.'); };
			const bridge = { getEnvironment: async () => null, signalReady: async () => undefined,
				setLocale: async () => undefined, onMenuCommand: () => () => undefined,
				onOpenProject: () => () => undefined, onCloseRequested: () => () => undefined,
				onWindowStateChanged: () => () => undefined,
				listAssistanceModels: async () => ({ runtimeAvailable: true, runtimeReason: null, models: [] }),
				installAssistanceModel: unavailable, cancelAssistanceModelInstall: unavailable,
				installPreseededAssistanceModel: unavailable, reconcileAssistanceModels: unavailable,
				collectAssistanceModelGarbage: unavailable, listAssistanceModelNotices: async () => [],
				relocateAssistanceModels: unavailable, removeAssistanceModel: unavailable,
				onAssistanceInstallProgress: () => () => undefined,
			};
			Object.defineProperty(globalThis, 'framescaperDesktop', { configurable: true, enumerable: true,
				value: Object.freeze({ v1: Object.freeze(bridge) }) });
			globalThis.__corridorKeyFixture = { installs: () => installs };
		});
		const errors = collectClientErrors(page);
		const editor = await bootEditor(page, '/framescaper/en/');
		await expect(page.locator('[data-editor-surface="corridorkey-2.0"]')).toHaveCount(0);
		await expect(editor.getByRole('button', { name: 'CorridorKey 2.0', exact: true })).toHaveCount(0);
		await chooseNestedCommandAction(page, editor, 'Effect', ['Video effects', 'CorridorKey 2.0']);
		const dialog = page.getByRole('dialog', { name: 'CorridorKey 2.0', exact: true });
		await expect(dialog).toContainText('CorridorKey 2.0 is not available in this build.');
		await expect(dialog.getByRole('button', { name: 'Download all', exact: true })).toBeDisabled();
		expect(await page.evaluate(() => globalThis.__corridorKeyFixture.installs())).toBe(0);
		await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
		await expect(dialog).toBeHidden(); expect(errors).toEqual([]);
	});
});
