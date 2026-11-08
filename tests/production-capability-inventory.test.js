/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import test from 'node:test';

import { PRODUCT_IDS, PRODUCT_PROFILES } from '../src/common/products.js';

const inventoryUrl = new URL('../config/production-capabilities.json', import.meta.url);
const PLATFORM_TIERS = ['web-core', 'web-enhanced', 'electron-enhanced', 'electron-only'];
const DESKTOP_TARGETS = [
	['linux', 'arm64'],
	['linux', 'x64'],
	['macos', 'arm64'],
	['windows', 'arm64'],
	['windows', 'x64'],
];

test('production capability inventory covers every product profile and platform tier', async () => {
	const inventory = JSON.parse(await readFile(inventoryUrl, 'utf8'));

	assert.equal(inventory.schemaVersion, 1);
	assert.equal(inventory.releaseLineAuthority, 'config/product-release-lines.json');
	assert.deepEqual(inventory.platformTiers, PLATFORM_TIERS);
	assert.deepEqual(Object.keys(inventory.products).sort(), [...PRODUCT_IDS].sort());

	for (const productId of PRODUCT_IDS) {
		const expected = PRODUCT_PROFILES[productId];
		const actual = inventory.products[productId];
		assert.equal(actual.profileEvidence, `src/${productId}/product.js`);
		assert.deepEqual(actual.importFamilies, expected.importChoices);
		assert.deepEqual(actual.exportFamilies, expected.exportChoices);
		assert.deepEqual(actual.projectFeatures, expected.capabilities);
		assert.deepEqual(actual.applicationFeatures, expected.applicationFeatures);
		assert.deepEqual(Object.keys(actual.platforms), PLATFORM_TIERS);
		for (const tier of PLATFORM_TIERS) {
			assert.match(actual.platforms[tier].status, /^(available|partial|planned|not-applicable)$/u);
			assert.ok(actual.platforms[tier].evidence.length > 0, `${productId}/${tier} needs evidence`);
		}
	}
});

test('product release metadata records each product software status', async () => {
	const inventory = JSON.parse(await readFile(inventoryUrl, 'utf8'));
	assert.equal(Object.hasOwn(inventory, 'productVersions'), false);
	assert.deepEqual(inventory.products.soundscaper.release, {
		softwareStatus: 'feature-complete',
	});
	assert.deepEqual(inventory.products.framescaper.release, {
		softwareStatus: 'pre-release',
	});
	assert.deepEqual(inventory.products.lightscaper.release, {
		softwareStatus: 'pre-release', channel: 'deferred',
		candidateVersion: '0.1.0-beta.1', stableTarget: null,
	});
});

test('Lightscaper runtime tiers record partial availability and their own implemented boundaries', async () => {
	const inventory = JSON.parse(await readFile(inventoryUrl, 'utf8'));
	const photo = inventory.products.lightscaper;
	assert.deepEqual(photo.exportFamilies, ['photos', 'scape']);
	assert.equal(photo.projectFeatures.photoExport, true);
	assert.equal(photo.projectFeatures.photoRaw, true);
	assert.equal(photo.projectFeatures.project, false, 'the catalog archive family does not enable timeline project authoring');
	for (const [tierName, paths] of Object.entries({
		'web-core': [
			'src/lightscaper/photo-library-session-runtime-current-v1.ts',
			'tests/browser/lightscaper-photo-raster-export-matrix-current.spec.ts',
			'tests/browser/lightscaper-raw-import-current.spec.js',
		],
		'web-enhanced': [
			'src/lightscaper/storage/photo-media-store.ts',
			'src/lightscaper/photo-develop-gpu-preview-current-v1.ts',
			'tests/browser/lightscaper-managed-fallback-ui-current.spec.ts',
			'tests/browser/lightscaper-develop-gpu-preview-current.spec.js',
		],
		'electron-enhanced': [
			'desktop/lightscaper-native-photo-session-service-current-v1.ts',
			'src/lightscaper/desktop-photo-library-session-runtime-current-v1.ts',
			'desktop/lightscaper-native-photo-raw-current-v1.ts',
			'tests/lightscaper-desktop-native-session-runtime-current.test.ts',
			'scripts/lightscaper-desktop-native-qualification-current-v1.ts',
		],
		'electron-only': [
			'desktop/lightscaper-native-photo-granted-filesystem-current-v1.ts',
			'src/lightscaper/desktop-photo-linked-library-current-v1.ts',
			'tests/lightscaper-native-granted-filesystem-current.test.ts',
			'tests/lightscaper-native-linked-workflow-commands-current.test.tsx',
		],
	})) {
		const tier = photo.platforms[tierName];
		assert.equal(tier.status, 'partial', `${tierName} availability remains conditional`);
		for (const path of paths) assert.ok(tier.evidence.includes(path), `${tierName} is missing ${path}`);
	}
});

test('production capability inventory records browser and desktop QA targets', async () => {
	const inventory = JSON.parse(await readFile(inventoryUrl, 'utf8'));
	const browsers = inventory.browserTargets;

	assert.deepEqual(Object.keys(browsers), ['chromium', 'firefox', 'webkit']);
	assert.equal(browsers.chromium.automated, true);
	assert.equal(browsers.firefox.automated, true);
	assert.equal(browsers.webkit.automated, true);
	for (const [family, target] of Object.entries(browsers)) {
		assert.ok(target.project.length > 0, `${family} must name a Playwright project`);
		assert.equal(target.automationStatus, 'configured');
		assert.equal(Object.hasOwn(target, 'releaseStatus'), false);
	}

	assert.deepEqual(
		inventory.desktopTargets.map(({ os, architecture }) => [os, architecture]).sort(),
		DESKTOP_TARGETS,
	);
	for (const target of inventory.desktopTargets) {
		assert.match(target.packageGate, /^(smoke-tested|packaged|planned)$/u);
		assert.ok(target.evidence.length > 0, `${target.os}/${target.architecture} needs evidence`);
	}
});

test('MIDI stays absent while Framescaper capture is a separate application capability', async () => {
	const inventory = JSON.parse(await readFile(inventoryUrl, 'utf8'));
	const serializedProfiles = JSON.stringify(inventory.products).toLowerCase();
	const dependencyMetadata = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
	const dependencyNames = Object.keys({
		...dependencyMetadata.dependencies,
		...dependencyMetadata.devDependencies,
	});

	assert.doesNotMatch(serializedProfiles, /midi/u);
	assert.deepEqual(inventory.products.soundscaper.applicationFeatures, {});
	assert.deepEqual(inventory.products.framescaper.applicationFeatures, {
		framescaperCapture: true, framescaperWebVcr: true,
	});
	assert.equal(inventory.products.framescaper.projectFeatures.audioRecording, false);
	assert.equal(inventory.products.soundscaper.projectFeatures.timelineAnnotations, true);
	assert.equal(inventory.products.framescaper.projectFeatures.timelineAnnotations, true);
	assert.equal(inventory.products.soundscaper.projectFeatures.trackFolders, true);
	assert.equal(inventory.products.framescaper.projectFeatures.trackFolders, false);
	assert.equal(inventory.products.soundscaper.projectFeatures.audioWarp, true);
	assert.equal(inventory.products.soundscaper.projectFeatures.videoRetime, false);
	assert.equal(inventory.products.framescaper.projectFeatures.audioWarp, false);
	assert.equal(inventory.products.framescaper.projectFeatures.videoRetime, true);
	assert.equal(inventory.products.soundscaper.projectFeatures.nestedSequences, false);
	assert.equal(inventory.products.framescaper.projectFeatures.nestedSequences, true);
	assert.equal(inventory.products.soundscaper.projectFeatures.multicamera, false);
	assert.equal(inventory.products.framescaper.projectFeatures.multicamera, true);
	for (const capability of [
		'audioAutomation', 'audioMixerGraph',
		'videoAdjustmentLayers', 'videoCaptions', 'videoColorManagement', 'videoDenoise',
		'videoFreeze', 'videoGenerators', 'videoGrading', 'videoMasksMattes',
		'videoMotionTracking', 'videoStabilization', 'videoStills',
		'videoTransitionDissolve', 'videoTransitions',
	]) assert.equal(inventory.products.framescaper.projectFeatures[capability], true, capability);
	assert.equal(inventory.products.framescaper.projectFeatures.audioEffects, false);
	for (const capability of [
		'videoCaptions', 'videoColorManagement', 'videoDenoise', 'videoGrading',
		'videoMotionTracking', 'videoStabilization',
	]) assert.equal(inventory.products.soundscaper.projectFeatures[capability], false, capability);
	assert.equal(inventory.products.framescaper.projectFeatures.ofxEffects, true);
	assert.equal(inventory.products.framescaper.platforms['electron-only'].status, 'partial');
	assert.deepEqual(dependencyNames.filter((name) => /midi/u.test(name)), []);
});

test('Electron Enhanced inventory records product-owned current desktop boundaries', async () => {
	const inventory = JSON.parse(await readFile(inventoryUrl, 'utf8'));
	const soundscaper = inventory.products.soundscaper.platforms['electron-enhanced'];
	const framescaper = inventory.products.framescaper.platforms['electron-enhanced'];
	assert.equal(soundscaper.status, 'partial');
	assert.equal(framescaper.status, 'partial');
	for (const path of [
		'desktop/desktop-smoke.js',
		'desktop/soundscaper-project-library-main.ts',
		'desktop/native-audio-session-service.ts',
		'desktop/plugin-host-service.ts',
		'src/common/editor/ui/soundscaper-native-renderer-bridge.ts',
		'desktop/soundscaper-delivery-database.ts',
		'desktop/soundscaper-delivery-service.ts',
		'desktop/soundscaper-delivery-publication.ts',
		'desktop/soundscaper-delivery-main-ipc.ts',
		'desktop/soundscaper-delivery-worker-port.ts',
		'desktop/soundscaper-delivery-registration.mjs',
		'src/common/editor/soundscaper-persistent-delivery-save-target.ts',
		'src/common/editor/controller/export/soundscaper-persistent-delivery-controller-composition.ts',
		'src/common/editor/controller/export/internal/delivery/soundscaper-persistent-delivery-private-transport.ts',
		'src/common/editor/controller/export/internal/delivery/soundscaper-persistent-delivery-ui-service.ts',
		'src/common/editor/controller/export/internal/delivery/soundscaper-persistent-delivery-worker.ts',
		'tests/desktop-soundscaper-delivery-database.test.ts',
		'tests/desktop-soundscaper-delivery-service.test.ts',
		'tests/desktop-soundscaper-delivery-main-ipc.test.ts',
		'tests/desktop-soundscaper-delivery-worker-port.test.ts',
		'tests/desktop-preload-persistent-delivery.test.js',
		'tests/audio-editor-soundscaper-persistent-delivery-composition.test.ts',
		'tests/audio-editor-soundscaper-persistent-delivery-private-transport.test.ts',
		'src/soundscaper/editor-project.ts',
		'src/soundscaper/editor-project-runtime-profile.ts',
		'src/soundscaper/editor-controller.ts',
		'desktop/project-library-lease-smoke.js',
		'scripts/lib/desktop-project-library-lease-matrix.mjs',
		'tests/desktop-project-library-lease-matrix.test.js',
		'.github/workflows/desktop-preview.yml',
	]) assert.ok(soundscaper.evidence.includes(path), `soundscaper is missing ${path}`);
	for (const path of [
		'desktop/desktop-smoke.js',
		'desktop/framescaper-project-library-main.ts',
		'desktop/native-services-runtime-v3.ts',
		'desktop/native-media-v14-executor.ts',
		'src/framescaper/editor-project.ts',
		'src/framescaper/editor-project-environment.ts',
		'src/framescaper/editor-project-runtime-profile.ts',
		'src/framescaper/editor-native-render-input-stream-producer.ts',
		'desktop/project-library-product-runtime.js',
		'desktop/framescaper-baseline-artifact-smoke.js',
		'tests/desktop-framescaper-project-library-baseline.test.ts',
		'tests/desktop-framescaper-baseline-artifact-smoke.test.js',
		'.github/workflows/desktop-preview.yml',
	]) assert.ok(framescaper.evidence.includes(path), `framescaper is missing ${path}`);
});

test('Electron Only inventory records the default-off native service surfaces', async () => {
	const inventory = JSON.parse(await readFile(inventoryUrl, 'utf8'));
	const soundscaper = inventory.products.soundscaper.platforms['electron-only'];
	const framescaper = inventory.products.framescaper.platforms['electron-only'];
	assert.equal(soundscaper.status, 'partial');
	assert.equal(framescaper.status, 'partial');
	for (const path of [
		'desktop/plugin-registration.mjs',
		'desktop/native-helper-persistent-plugin-job.js',
		'src/common/editor/native-plugin-realtime-node.js',
		'src/common/editor/ui/dialogs/SoundscaperNativeServicesDialog.tsx',
	]) assert.ok(soundscaper.evidence.includes(path), `soundscaper Electron Only is missing ${path}`);
	for (const path of [
		'desktop/native-services-controller-v3.ts',
		'desktop/openfx-main-service.ts',
		'src/common/editor/ui/framescaper-native-services-menu.ts',
		'src/framescaper/editor-controller.ts',
		'src/framescaper/editor-native-render-queue-action.ts',
		'src/framescaper/editor-native-openfx-action.ts',
		'src/framescaper/editor-project-native-media.ts',
	]) assert.ok(framescaper.evidence.includes(path), `framescaper Electron Only is missing ${path}`);
});

test('Linux x64 inventory pins the current product-aware artifact smoke', async () => {
	const inventory = JSON.parse(await readFile(inventoryUrl, 'utf8'));
	const target = inventory.desktopTargets.find(
		({ os, architecture }) => os === 'linux' && architecture === 'x64',
	);

	assert.ok(target);
	for (const path of [
		'desktop/desktop-smoke.js',
		'scripts/lib/desktop-smoke.mjs',
		'scripts/desktop-smoke.mjs',
		'tests/desktop-smoke-probe.test.js',
		'tests/desktop-smoke.test.js',
		'.github/workflows/desktop-preview.yml',
	]) assert.ok(target.evidence.includes(path), `linux/x64 is missing ${path}`);
	assert.equal(
		target.evidence.includes('tests/desktop-soundscaper-project-library-baseline.test.ts'),
		false,
		'composed Node mixed-media acceptance is not packaged Linux evidence',
	);
});

test('every capability claim points at checked-in evidence', async () => {
	const inventory = JSON.parse(await readFile(inventoryUrl, 'utf8'));
	const evidence = [
		...Object.values(inventory.browserTargets).flatMap((target) => target.evidence),
		...inventory.desktopTargets.flatMap((target) => target.evidence),
		...Object.values(inventory.products).flatMap((product) => [
			product.profileEvidence,
			...product.projectSchemaIdentity.evidence,
			...Object.values(product.platforms).flatMap((platform) => platform.evidence),
		]),
	];

	for (const reference of new Set(evidence)) {
		const [repositoryPath] = reference.split('#');
		await assert.doesNotReject(
			access(new URL(`../${repositoryPath}`, import.meta.url)),
			`Missing capability evidence: ${reference}`,
		);
	}
});
