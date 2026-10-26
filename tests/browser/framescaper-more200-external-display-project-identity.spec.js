/* SPDX-License-Identifier: AGPL-3.0-only */

import { Buffer } from 'node:buffer';
import { installDesktopSpeedWarmupManifest } from './helpers/desktop-speed-warmup-fixture.js';
import { expect, test } from './audio-editor-test-fixtures.js';
import { bootEditor, chooseNestedCommandAction, waitForProjectActivation } from './audio-editor-test-helpers.js';
import { seekFramescaperTimecode } from './helpers/framescaper-standard-timecode.js';
import { hasWebGl2Capability } from './helpers/webgl2-capability.js';
import { createRound7ExternalDisplayNativeFixture } from '../helpers/round7-external-display-native-fixture.ts';
import { createFramescaperProject } from '../../src/framescaper/editor-project.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE as PROFILE } from '../../src/framescaper/editor-project-runtime-profile.ts';
import { createFramescaperProjectStore } from '../../src/framescaper/editor-project-store.ts';
import { createFramescaperScapeNativeRuntime } from '../../src/framescaper/editor-scape-native.ts';

for (const { id, trackId } of [{ id: 'Programme:one', trackId: 'pictures' },
	{ id: 'Programme 映像', trackId: 'pictures' }, { id: 'track-identity', trackId: 'Pictures 映像' }]) test(`File Open preserves ${id}/${trackId} in preview and clean-display publication`, async ({ page }) => {
	test.setTimeout(60_000);
	const native = createRound7ExternalDisplayNativeFixture();
	try {
		await page.exposeBinding('__identityDisplayNative', async (_context, method, request) => {
			if (method === 'presentExternalDisplay') request = { ...request, rgba: Uint8Array.from(request.rgba) };
			return await native.bridge[method](request);
		});
		await installDesktopSpeedWarmupManifest(page);
		await page.addInitScript(() => {
			const nativeServices = Object.fromEntries(['snapshot', 'control', 'reorder', 'remove', 'capabilities',
				'preferences', 'externalDisplays', 'setExternalDisplay', 'presentExternalDisplay'].map(method => [method,
				async request => window.__identityDisplayNative(method, method === 'presentExternalDisplay'
					? { ...request, rgba: Array.from(request.rgba) } : request)]));
			const controls = { probeHelperEnabled: false, probeHelperQuarantined: false,
				audioHelperEnabled: false, audioHelperQuarantined: false, nativeEffectDiscoveryEnabled: false };
			Object.defineProperty(window, 'framescaperDesktop', { configurable: true, enumerable: true, value: Object.freeze({ v1: Object.freeze({
				nativeServices: Object.freeze(nativeServices),
				getExternalFfmpegStatus: async () => ({ state: 'unconfigured', location: null, version: null,
					detail: '', canInstall: false, canBrowse: false, canClear: false }),
				readNativeTierControls: async () => ({ ...controls }), applyNativeTierControl: async () => ({ ...controls }),
			}) }) });
		});
		const project = createFramescaperProject(PROFILE, { id, title: 'Programme',
			visualModel: { generatorSources: [{ schemaVersion: 1, kind: 'generator', id: 'solid-source', name: 'Solid',
				width: 640, height: 360, frameRate: { num: 30, den: 1 }, frameCount: 150,
				generator: { kind: 'solid', color: '#ff0000ff' } }] },
			clips: [{ schemaVersion: 1, kind: 'generator', id: 'solid', sourceId: 'solid-source', sequenceId: 'main',
				sequenceStartFrame: 0, sequenceFrameCount: 150, sourceInFrame: 0, sourceFrameCount: 150 }],
			tracks: [{ id: trackId, type: 'video', clipIds: ['solid'] }],
			sequences: [{ id: 'main', rate: { num: 30, den: 1 }, trackIds: [trackId] }], primarySequenceId: 'main' });
		const store = createFramescaperProjectStore(PROFILE, { indexedDB: null, preferOpfs: false });
		let archive;
		try { archive = await createFramescaperScapeNativeRuntime(PROFILE).exportScapeProject(project, store); }
		finally { await store.close(); }
		const editor = await bootEditor(page, '/framescaper/embed/en/');
		test.skip(!await page.evaluate(hasWebGl2Capability), 'Clean display requires the real evaluated framebuffer.');
		await editor.locator('[data-aup4-input]').setInputFiles({ name: 'Programme.fscape', mimeType: 'application/zip',
			buffer: Buffer.from(await archive.blob.arrayBuffer()) });
		await expect(editor).toHaveAttribute('data-project-id', project.id); await waitForProjectActivation(editor);
		const preview = editor.locator('[data-video-preview]');
		await expect(preview).toHaveAttribute('data-video-preview-renderer', 'ready', { timeout: 30_000 });
		await chooseNestedCommandAction(page, editor, 'View', ['External display', 'Programme A']);
		await seekFramescaperTimecode(page, editor, '00:00:00:01');
		await expect.poll(() => native.frames.length).toBeGreaterThan(0);
		expect(native.frames.every(frame => frame.windowId === 1)).toBe(true);
		await chooseNestedCommandAction(page, editor, 'View', ['External display', 'None']);
	} finally { native.release(); await native.dispose(); }
});
