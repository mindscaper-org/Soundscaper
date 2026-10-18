/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const CONTROL_ID = 'framescaper-web-vcr-dormant-isolated-guest';
const FIXTURE_ID = 'm8plus-web-vcr-loopback-https-v1';
const WORKLOAD_ID = 'm8plus-web-vcr-long-session';

test('Web VCR is enabled for ordinary Framescaper testing', async () => {
	const capabilities = await json('config/production-capabilities.json');
	const framescaper = capabilities.products.framescaper;
	assert.equal(framescaper.applicationFeatures.framescaperWebVcr, true);
	assert.equal(framescaper.platforms['electron-enhanced'].status, 'partial');
	assert.equal(framescaper.platforms['electron-only'].status, 'partial');
	for (const path of [
		'src/common/editor/web-vcr-domain.ts',
		'src/common/editor/web-vcr-geometry.ts',
		'src/common/editor/controller/capture/internal/web-vcr/framescaper-web-vcr-controller.ts',
		'src/common/editor/controller/capture/framescaper-web-vcr-controller-types.ts',
		'src/common/editor/controller/capture/internal/web-vcr/framescaper-web-vcr-snapshot-order.ts',
		'src/common/editor/controller/capture/internal/framescaper-capture-device-adapter.ts',
		'src/common/editor/controller/capture/internal/framescaper-capture-source-adapter-router.ts',
		'src/common/editor/controller/capture/internal/web-vcr/web-vcr-recorder-factory.ts',
		'src/common/editor/controller/capture/internal/web-vcr/web-vcr-video-frame-crop.ts',
		'src/common/editor/ui/workspace/WebVcrPanel.tsx',
		'src/common/editor/ui/workspace/desktop-editor-close-work.ts',
		'desktop/framescaper-web-vcr-contract.ts',
		'desktop/framescaper-web-vcr-electron-window.ts',
		'desktop/framescaper-web-vcr-host.ts',
		'desktop/framescaper-web-vcr-guest-security.ts',
		'desktop/framescaper-web-vcr-runtime.ts',
		'desktop/framescaper-web-vcr-runtime-support.ts',
		'desktop/framescaper-web-vcr-registration.ts',
		'desktop/framescaper-web-vcr-runtime-snapshot.ts',
		'desktop/framescaper-web-vcr-security-policy.ts',
		'tests/audio-editor-web-vcr-domain.test.ts',
		'tests/audio-editor-web-vcr-geometry.test.ts',
		'tests/audio-editor-framescaper-capture-source-adapter-router.test.ts',
		'tests/desktop-framescaper-web-vcr-host.test.ts',
		'tests/desktop-framescaper-web-vcr-guest-security.test.ts',
		'tests/desktop-framescaper-web-vcr-runtime.test.ts',
		'tests/desktop-framescaper-web-vcr-registration.test.ts',
		'tests/desktop-framescaper-web-vcr-packaged-inventory.test.js',
		'tests/audio-editor-web-vcr-snapshot-order.test.ts',
	]) assert.ok(
		framescaper.platforms['electron-enhanced'].evidence.includes(path),
		`Electron Enhanced inventory needs Web VCR evidence from ${path}`,
	);
	assert.equal(capabilities.products.soundscaper.applicationFeatures.framescaperWebVcr, undefined);
});

test('Web VCR isolated-guest control retains its implementation and verification evidence', async () => {
	const matrix = await json('config/production-security-matrix.json');
	const risk = matrix.risks.find(({ id }) => id === 'electron-renderer-ipc-boundary');
	const control = risk?.currentControls.find(({ id }) => id === CONTROL_ID);
	assert.ok(control);
	assertEvidence(control, [
		'desktop/framescaper-web-vcr-capture-authority.ts',
		'desktop/framescaper-web-vcr-contract.ts',
		'desktop/framescaper-web-vcr-electron-window.ts',
		'desktop/framescaper-web-vcr-guest-security.ts',
		'desktop/framescaper-web-vcr-host.ts',
		'desktop/framescaper-web-vcr-preload.ts',
		'desktop/framescaper-web-vcr-registration.ts',
		'desktop/framescaper-web-vcr-runtime-snapshot.ts',
		'desktop/framescaper-web-vcr-runtime.ts',
		'desktop/framescaper-web-vcr-runtime-support.ts',
		'desktop/framescaper-web-vcr-security-policy.ts',
		'desktop/framescaper-web-vcr-target-observer.ts',
		'desktop/framescaper-capture-registration.mjs',
		'src/common/editor/web-vcr-domain.ts',
		'src/common/editor/web-vcr-geometry.ts',
		'src/common/editor/controller/capture/framescaper-capture-app-composition.ts',
		'src/common/editor/controller/capture/internal/framescaper-capture-device-adapter.ts',
		'src/common/editor/controller/capture/internal/framescaper-capture-source-adapter-router.ts',
		'src/common/editor/controller/capture/internal/web-vcr/framescaper-web-vcr-snapshot-order.ts',
		'src/common/editor/ui/workspace/desktop-editor-close-work.ts',
		'tests/desktop-framescaper-web-vcr-authority.test.ts',
		'tests/desktop-framescaper-web-vcr-contract.test.ts',
		'tests/desktop-framescaper-web-vcr-guest-security.test.ts',
		'tests/desktop-framescaper-web-vcr-host.test.ts',
		'tests/desktop-framescaper-web-vcr-runtime.test.ts',
		'tests/desktop-framescaper-web-vcr-registration.test.ts',
		'tests/desktop-framescaper-web-vcr-packaged-inventory.test.js',
		'tests/desktop-framescaper-web-vcr-security-policy.test.ts',
		'tests/desktop-framescaper-web-vcr-target-observer.test.ts',
		'tests/audio-editor-framescaper-capture-app-composition.test.ts',
		'tests/audio-editor-framescaper-capture-source-adapter-router.test.ts',
		'tests/audio-editor-web-vcr-snapshot-order.test.ts',
		'tests/audio-editor-desktop-close-capture-work.test.ts',
		'tests/desktop-framescaper-capture-registration.test.js',
		'tests/production-security-framescaper-web-vcr-policy.test.js',
	]);
});

test('Web VCR quality inventory omits unimplemented workload registrations', async () => {
	const quality = await json('config/quality-budgets.json');
	const fixture = quality.fixtures.find(({ id }) => id === FIXTURE_ID);
	const workload = quality.workloads.find(({ id }) => id === WORKLOAD_ID);
	assert.equal(fixture, undefined);
	assert.equal(workload, undefined);
	assert.equal(Object.hasOwn(quality, 'environments'), false);
	assert.equal(Object.hasOwn(quality, 'qualification'), false);
});

async function json(path) {
	return JSON.parse(await text(path));
}

async function text(path) {
	return readFile(new URL(`../${path}`, import.meta.url), 'utf8');
}

function assertEvidence(control, paths) {
	const evidence = new Set(control.evidence.map(({ path }) => path));
	for (const path of paths) assert.ok(evidence.has(path), path);
}
