/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const SECURITY_CONTROL = 'framescaper-capture-durability-and-atomic-publication';
const DESKTOP_CONTROL = 'framescaper-capture-desktop-consent-authority';

test('Framescaper capture policy binds consent, recovery, origin, and publication evidence', async () => {
	const matrix = await json('config/production-security-matrix.json');
	const cancellation = matrix.risks.find(({ id }) => id === 'long-job-cancellation');
	const capture = cancellation?.currentControls.find(({ id }) => id === SECURITY_CONTROL);
	assert.ok(capture);
	assert.equal(cancellation.status, 'partial');
	assertEvidence(capture, [
		'src/common/editor/framescaper-capture-domain.ts',
		'src/common/editor/framescaper-capture-session-manifest.ts',
		'src/common/editor/controller/capture/framescaper-capture-app-binding.ts',
		'src/common/editor/controller/capture/internal/framescaper-capture-runtime-probe.ts',
		'src/common/editor/controller/capture/internal/framescaper-capture-durable-session.ts',
		'src/common/editor/controller/capture/internal/framescaper-capture-canonical-publication.ts',
		'src/common/editor/controller/capture/framescaper-capture-origin-guard.ts',
		'src/common/editor/storage/capture-spool-append-intent-repository.ts',
		'src/common/editor/storage/capture-spool-operation-lock.ts',
		'src/common/editor/storage/framescaper-capture-session-manifest-repository.ts',
		'src/framescaper/product.js',
		'src/framescaper/editor-captured-video-proxy-desktop-publication.ts',
		'src/framescaper/editor-captured-video-proxy-scheduler.ts',
		'tests/audio-editor-framescaper-capture-app-composition.test.ts',
		'tests/audio-editor-framescaper-capture-origin-guard.test.ts',
		'tests/audio-editor-framescaper-capture-rollback-lock.test.ts',
		'tests/audio-editor-framescaper-capture-terminal-retirement.test.ts',
		'tests/framescaper-capture-cloudflare-policy.test.js',
	]);

	const ipc = matrix.risks.find(({ id }) => id === 'electron-renderer-ipc-boundary');
	const desktop = ipc?.currentControls.find(({ id }) => id === DESKTOP_CONTROL);
	assert.ok(desktop);
	assert.equal(ipc.status, 'enforced');
	assertEvidence(desktop, [
		'desktop/framescaper-capture-artifact-smoke.js',
		'desktop/framescaper-capture-desktop-port.ts',
		'desktop/framescaper-capture-preload.ts',
		'desktop/framescaper-capture-registration.mjs',
		'desktop/framescaper-capture-session-security.ts',
		'desktop/soundscaper-capture-session-security.ts',
		'desktop/protocol.js',
		'electron-builder.config.cjs',
		'scripts/lib/desktop-product-package-files.mjs',
		'scripts/lib/desktop-soundscaper-runtime-files.mjs',
		'src/common/editor/recording-capture-pool.js',
		'src/framescaper/product.js',
		'tests/audio-editor-recording-inputs.test.js',
		'tests/desktop-framescaper-capture-desktop-port.test.ts',
		'tests/desktop-framescaper-capture-artifact-smoke.test.js',
		'tests/desktop-framescaper-capture-session-security.test.ts',
		'tests/desktop-framescaper-capture-packaging.test.js',
		'tests/desktop-framescaper-capture-protocol-policy.test.js',
		'tests/desktop-product-package-isolation.test.js',
		'tests/desktop-protocol.test.js',
		'tests/desktop-soundscaper-capture-session-security.test.ts',
		'tests/desktop-staged-typescript-guard.test.js',
		'tests/framescaper-capture-cloudflare-policy.test.js',
	]);
});

test('Framescaper capability and quality inventories retain capture activation and evidence', async () => {
	const [capabilities, quality] = await Promise.all([
		json('config/production-capabilities.json'),
		json('config/quality-budgets.json'),
	]);
	const framescaper = capabilities.products.framescaper;
	assert.equal(framescaper.projectFeatures.audioRecording, false);
	assert.deepEqual(framescaper.applicationFeatures, {
		framescaperCapture: true, framescaperWebVcr: true,
	});
	assert.equal(framescaper.platforms['web-core'].status, 'available');
	assert.equal(framescaper.platforms['web-enhanced'].status, 'partial');
	assert.equal(framescaper.platforms['electron-enhanced'].status, 'partial');
	assert.equal(framescaper.platforms['electron-only'].status, 'partial');
	for (const [tier, paths] of Object.entries({
		'web-core': [
			'src/framescaper/editor-project.ts',
			'src/framescaper/editor-controller.ts',
			'src/common/editor/controller/capture/internal/framescaper-capture-session-service.ts',
			'src/common/editor/ui/workspace/RecordingSetupPanel.tsx',
			'tests/audio-editor-framescaper-capture-ui.test.tsx',
		],
		'web-enhanced': [
			'src/framescaper/product-route.ts',
			'src/framescaper/ui/FramescaperAudioEditorBootstrap.tsx',
			'src/framescaper/editor-controller.ts',
			'src/framescaper/editor-project-environment.ts',
			'src/common/editor/controller/capture/internal/browser/framescaper-browser-capture-source.ts',
			'src/common/editor/controller/capture/framescaper-capture-app-composition.ts',
			'src/common/editor/controller/capture/internal/framescaper-capture-canonical-pcm.ts',
			'src/common/editor/controller/capture/internal/framescaper-capture-canonical-publication.ts',
			'src/common/editor/controller/capture/internal/framescaper-capture-durable-session.ts',
			'src/common/editor/storage/capture-spool-append-intent-repository.ts',
			'src/common/editor/storage/capture-spool-operation-lock.ts',
			'src/common/editor/storage/capture-spool-tail-cleanup-repository.ts',
			'src/common/editor/storage/framescaper-capture-session-creation-repository.ts',
			'src/common/editor/storage/raw-pcm-spool-global-inventory.ts',
			'src/framescaper/editor-captured-video-proxy-scheduler-composition.ts',
			'src/framescaper/editor-captured-video-proxy-scheduler.ts',
			'tests/audio-editor-framescaper-capture-app-composition.test.ts',
			'tests/audio-editor-framescaper-capture-prewrite-intent.test.ts',
			'tests/audio-editor-framescaper-capture-rollback-lock.test.ts',
			'tests/audio-editor-framescaper-capture-terminal-retirement.test.ts',
			'tests/audio-editor-framescaper-capture-derivative-scheduler.test.ts',
			'tests/framescaper-capture-cloudflare-policy.test.js',
		],
		'electron-enhanced': [
			'desktop/framescaper-capture-artifact-smoke.js',
			'desktop/framescaper-capture-registration.mjs',
			'desktop/framescaper-capture-session-security.ts',
			'tests/desktop-framescaper-capture-packaging.test.js',
			'tests/desktop-framescaper-capture-artifact-smoke.test.js',
			'src/framescaper/editor-captured-video-proxy-desktop-publication.ts',
			'src/framescaper/editor-controller.ts',
			'tests/audio-editor-framescaper-capture-app-composition.test.ts',
		],
	})) for (const path of paths) assert.ok(
		framescaper.platforms[tier].evidence.includes(path), `${tier} needs ${path}`,
	);

	const captureFixture = quality.fixtures.find(({ id }) => id === 'm8a-capture-30m-all-sources-v1');
	const captureWorkload = quality.workloads.find(({ id }) => id === 'm8a-capture-long-session');
	assert.equal(captureFixture?.kind, 'observed-capture-session');
	assert.equal(captureWorkload?.behavior, 'blocking');
	assert.deepEqual(captureWorkload?.fixtureIds, ['m8a-capture-30m-all-sources-v1']);
	assert.deepEqual(captureWorkload?.measurementIds, [
		'capture.sourceCombinationsCompleted', 'capture.avDriftMaximumMs',
		'capture.droppedFrameRatio', 'capture.unreportedDroppedFrames',
		'capture.audioDropoutFrames', 'capture.deviceTeardownP95Ms',
		'capture.unrecoverableDurableFragments', 'capture.unauthorizedDeviceOpens',
	]);
	assert.equal(Object.hasOwn(quality, 'environments'), false);
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
