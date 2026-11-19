/* SPDX-License-Identifier: AGPL-3.0-only */

import { ordinaryFramescaperImage } from '../helpers/framescaper-ordinary-animation-fixture.ts';
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseNestedCommandAction } from './audio-editor-test-helpers.js';
import { installDesktopSpeedWarmupManifest } from './helpers/desktop-speed-warmup-fixture.js';
import { seekFramescaperTimecode } from './helpers/framescaper-standard-timecode.js';

for (const mixed of [false, true]) {
	test(`native render queue reports that it cannot include an APNG (${mixed ? 'mixed timeline' : 'image only'})`, async ({ page }) => {
		await installRenderQueueFixture(page);
		const editor = await bootEditor(page, '/framescaper/embed/en/');
		if (mixed) {
			await chooseNestedCommandAction(page, editor, 'Generate', ['Video Generators', 'Add Solid']);
			await expect(editor.getByRole('group', { name: 'Video clip: Solid', exact: true })).toHaveCount(1);
			await seekFramescaperTimecode(page, editor, '00:00:02:00');
		}
		await chooseNestedCommandAction(page, editor, 'Generate', ['Add Images']);
		const image = editor.getByRole('group', { name: 'Image clip: animation', exact: true });
		await expect(image).toHaveCount(1);
		await expect(editor.locator('[data-save-state]')).toHaveAttribute('data-state', 'saved');

		const dialog = await openPngQueue(page, editor);
		const status = await submitQueue(dialog);
		await expect(status).toHaveText('The native render queue cannot include imported images on this timeline. Use File > Export Video to retain them.');
		expect(await page.evaluate(() => globalThis.__ordinaryImageQueue)).toEqual({ roots: 0, frames: [], enqueued: 0 });

		if (!mixed) return;
		await dialog.getByRole('button', { name: 'Close', exact: true }).filter({ hasText: /^Close$/u }).click();
		await editor.getByRole('button', { name: 'Undo', exact: true }).click();
		await expect(image).toHaveCount(0);
		const cleanDialog = await openPngQueue(page, editor);
		await expect(await submitQueue(cleanDialog)).toHaveText('The project operation completed.');
		expect(await page.evaluate(() => globalThis.__ordinaryImageQueue)).toEqual({
			roots: 1, frames: [5], enqueued: 1,
		});
	});
}

async function openPngQueue(page, editor) {
	await chooseNestedCommandAction(page, editor, 'File', ['Export other', 'Add to render queue']);
	const dialog = page.getByRole('dialog', { name: 'Add to render queue', exact: true });
	await dialog.getByRole('combobox', { name: 'Delivery format', exact: true }).selectOption('png');
	await dialog.getByRole('spinbutton', { name: 'Frame rate numerator', exact: true }).fill('1');
	return dialog;
}

async function submitQueue(dialog) {
	const action = dialog.getByRole('button', { name: 'Continue', exact: true });
	await expect(action).toBeEnabled();
	await action.click();
	const status = dialog.getByRole('region', { name: 'Add to render queue', exact: true }).getByRole('status');
	await expect(status).not.toHaveText('Working');
	return status;
}

async function installRenderQueueFixture(page) {
	const apng = ordinaryFramescaperImage('animated.png');
	await page.route('**/__ordinary-animation.png', route => route.fulfill({ body: apng, contentType: 'image/png' }));
	await installDesktopSpeedWarmupManifest(page);
	await page.addInitScript((imageBytes) => {
		const journey = { roots: 0, frames: [], enqueued: 0 };
		const grant = { grantId: 'a'.repeat(16), displayName: 'Exports', revoked: false };
		const stageId = 'b'.repeat(40);
		globalThis.__ordinaryImageQueue = journey;
		Object.defineProperty(globalThis, 'framescaperDesktop', {
			enumerable: true, value: Object.freeze({ v1: Object.freeze({
				chooseFiles: async ({ purpose }) => purpose === 'image' ? [{
					id: '4'.repeat(64), readProfile: 'materialized-v1', name: 'animation.png',
					size: imageBytes, mimeType: 'image/png', lastModified: 123,
					url: `${location.origin}/__ordinary-animation.png`,
				}] : [],
				releaseRead: async () => true,
				nativeServices: Object.freeze({
					snapshot: async () => ({
						snapshotVersion: 1, runtimeAvailable: true, nativeMediaEnabled: true,
						queue: [], roots: [grant], watchRules: [],
					}),
					control: async () => ({}),
					reorder: async () => [],
					remove: async () => true,
					capabilities: async () => ({
						snapshotVersion: 1, masterEnabled: true, buildFingerprint: null,
						entries: [{
							domain: 'queue', id: 'persistent-render-queue', state: 'available',
							reason: 'ready', userEnabled: true, buildFingerprint: null, detail: null,
						}],
					}),
					preferences: async () => ({
						nativeMediaEnabled: true, hardwareDecodeEnabled: false,
						hardwareEncodeEnabled: false, ofxConsentEnabled: false,
					}),
					selectRoot: async () => { journey.roots += 1; return grant; },
					revalidateRoot: async () => true,
					stageLiveRenderInputs: async ({ carrierByteLength, planPayload }) => {
						journey.frames.push(JSON.parse(planPayload).output.frameCount);
						return { stageId, carrierByteLength, scratchByteLength: carrierByteLength };
					},
					enqueue: async () => { journey.enqueued += 1; return {}; },
					writeLiveRenderInput: async ({ sequence, offset, bytes }) => ({
						sequence, receivedBytes: offset + bytes.byteLength,
					}),
					completeLiveRenderInput: async ({ byteLength, sha256 }) => ({ byteLength, sha256 }),
					abandonRenderInputs: async () => true,
				}),
			}) }),
		});
	}, apng.length);
}
