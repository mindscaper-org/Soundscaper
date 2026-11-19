/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { test as base, expect } from '@playwright/test';
import catalog from '../../../config/local-model-catalog.json' with { type: 'json' };
import { resolvePackagedProductExecutable } from '../../../scripts/lib/desktop-packaged-product-executable.mjs';
import { launchModelTestElectron } from './electron-fixture.js';
import { createModelTestElectronFixture } from './model-test-fixture.ts';
import { exerciseDenoisingPorts, packagedDenoisingWorklet } from './denoise-port-driver.ts';

const test = base.extend<{ launchModelHost: () => ReturnType<typeof launchModelTestElectron> }>({
	launchModelHost: [createModelTestElectronFixture(testInfo => launchModelTestElectron({
		testInfo, productId: testInfo.project.metadata.productId, editor: true,
	})), { timeout: 120_000 }],
});

for (const sampleRate of [48_000, 44_100, 96_000]) for (const channels of [1, 2]) {
	test(`real Electron denoising ports: ${channels} channels at ${sampleRate} Hz survive a 500 ms UI stall`, async ({ launchModelHost }, testInfo) => {
		const model = catalog.entries.find(entry => entry.modelId === 'dpdfnet2-48khz');
		assert.ok(model, 'the streaming denoiser requires its published DPDFNet2 model');
		const platform = process.env.SOUNDSCAPER_PACKAGED_RUNTIME_PLATFORM ?? process.platform;
		const arch = process.env.SOUNDSCAPER_PACKAGED_RUNTIME_ARCH ?? process.arch;
		assert.ok(model.platforms.includes(`${platform}-${arch}`), 'DPDFNet2 must be published for every maintained target');
		const host = await launchModelHost();
		await host.installModel(model);
		const executable = resolvePackagedProductExecutable({
			productRoot: process.env.SOUNDSCAPER_PACKAGED_PRODUCT_ROOT,
			productId: testInfo.project.metadata.productId, platform, arch,
		});
		const resources = platform === 'darwin' ? resolve(dirname(executable), '../Resources') : resolve(dirname(executable), 'resources');
		const workletUrl = await packagedDenoisingWorklet(resources);
		const captureUrl = await packagedDenoisingWorklet(resources, 'kw-audio-render-capture');
		const speech = await readFile(new URL('./fixtures/jfk.wav', import.meta.url));
		const result = await exerciseDenoisingPorts(host.page, {
			sampleRate, channels, workletUrl, captureUrl, speechBase64: speech.toString('base64'),
		});
		await testInfo.attach('denoising-ports.json', { contentType: 'application/json',
			body: JSON.stringify({ package: host.packageIdentity, sampleRate, channels, workletUrl, ...result }, null, 2) });
		expect(result.frames).toBeGreaterThanOrEqual(sampleRate * 3);
		expect(result.energy).toBeGreaterThan(1);
		expect(result.finite).toBe(true);
		expect(result.stalled).toBe(true);
		expect(result.metrics.provider).toBe('webgpu');
	});
}
