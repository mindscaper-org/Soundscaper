/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const matrixUrl = new URL('../config/production-security-matrix.json', import.meta.url);
const ELECTRON_EVIDENCE = [
	'electron-builder.config.cjs',
	'config/electron-alternate-ffmpeg-manifest.json',
	'scripts/lib/electron-alternate-ffmpeg.mjs',
	'tests/desktop-electron-alternate-ffmpeg.test.js',
	'tests/production-security-desktop-codec-policy.test.js',
];
const BUNDLED_CODEC_EVIDENCE = [
	'src/common/editor/flac/source-manifest.json',
	'src/common/editor/opus/source-manifest.json',
	'src/common/editor/vorbis/source-manifest.json',
	'src/common/editor/wavpack/source-manifest.json',
	'src/common/editor/mpg123/source-manifest.json',
	'src/common/editor/lame/source-manifest.json',
	'src/common/editor/twolame/source-manifest.json',
	'src/common/editor/wavpack/NOTICE.md',
	'docs/architecture/desktop-codec-providers.md',
	'src/common/editor/desktop-wavpack-codec-profile.ts',
	'scripts/audit-flac-wasm.mjs',
	'scripts/audit-opus-wasm.mjs',
	'scripts/audit-vorbis-wasm.mjs',
	'scripts/audit-wavpack-wasm.mjs',
	'scripts/audit-mpg123-wasm.mjs',
	'scripts/audit-lame-wasm.mjs',
	'scripts/audit-twolame-wasm.mjs',
	'scripts/lib/desktop-bundled-audio-runtime.mjs',
	'scripts/lib/desktop-bundled-audio-codec-runtime-closure.mjs',
	'desktop/bundled-audio-codec-runtime-payload.mjs',
	'desktop/bundled-audio-codec-electron-spawn.mjs',
	'desktop/bundled-audio-codec-helper-process.ts',
	'desktop/bundled-audio-codec-operation-runner.ts',
	'desktop/one-shot-message-child-supervision.ts',
	'desktop/private-scratch-directory.ts',
	'desktop/authenticated-bundled-audio-codec-runtime-loader.ts',
	'desktop/bundled-audio-codec-runtime-support.ts',
	'desktop/direct-bundled-audio-codec-wasm.ts',
	'desktop/bundled-audio-codec-isolated-runtime.ts',
	'desktop/bundled-flac-audio-codec-runtime.ts',
	'desktop/bundled-opus-audio-codec-runtime.ts',
	'desktop/bundled-vorbis-audio-codec-runtime.ts',
	'desktop/bundled-wavpack-audio-codec-runtime.ts',
	'desktop/bundled-wavpack-stream.ts',
	'desktop/bundled-mpg123-audio-codec-runtime.ts',
	'desktop/bundled-lame-audio-codec-runtime.ts',
	'desktop/bundled-twolame-audio-codec-runtime.ts',
	'tests/desktop-bundled-flac-audio-codec-runtime.test.ts',
	'tests/desktop-bundled-opus-audio-codec-runtime.test.ts',
	'tests/desktop-bundled-vorbis-audio-codec-runtime.test.ts',
	'tests/desktop-bundled-wavpack-audio-codec-runtime.test.ts',
	'tests/desktop-bundled-mpg123-audio-codec-runtime.test.ts',
	'tests/desktop-bundled-lame-audio-codec-runtime.test.ts',
	'tests/desktop-bundled-twolame-audio-codec-runtime.test.ts',
	'tests/desktop-audio-codec-runtime-staging.test.js',
	'tests/desktop-bundled-audio-codec-runtime-payload.test.js',
	'tests/desktop-bundled-audio-codec-electron-spawn.test.js',
	'tests/desktop-bundled-audio-codec-helper-process.test.ts',
	'tests/desktop-bundled-audio-codec-operation-runner.test.ts',
	'tests/desktop-bundled-audio-codec-runtime-kernel.test.ts',
	'tests/desktop-one-shot-message-child-supervision.test.ts',
	'tests/desktop-private-scratch-directory.test.ts',
	'tests/desktop-bundled-audio-codec-isolated-runtime.test.ts',
];
const OS_CODEC_EVIDENCE = [
	'native/os-audio-codec-host/CMakeLists.txt',
	'native/os-audio-codec-host/src/node_api_bridge.cpp',
	'desktop/os-audio-codec-runtime.ts',
	'desktop/os-audio-codec-canary-adapter.ts',
	'desktop/os-audio-codec-native-payload.mjs',
	'scripts/build-os-audio-codec-host.mjs',
	'scripts/ci-build-os-audio-codec-host.mjs',
	'scripts/lib/os-audio-codec-host-build.mjs',
	'scripts/lib/os-audio-codec-host-ci.mjs',
	'scripts/lib/os-audio-codec-native-payload.mjs',
	'scripts/lib/desktop-os-audio-codec-native-staging.mjs',
	'scripts/lib/desktop-os-audio-codec-native-package-verification.mjs',
	'scripts/lib/desktop-package-os-audio-codec-closure.mjs',
	'tests/desktop-os-audio-codec-runtime.test.ts',
	'tests/os-audio-codec-host-build.test.js',
	'tests/os-audio-codec-host-ci.test.js',
	'tests/os-audio-codec-native-payload.test.js',
	'tests/desktop-packaged-os-audio-codec-native.test.js',
];
const EXTERNAL_CODEC_EVIDENCE = [
	'desktop/external-ffmpeg-audio-operation-runner.ts',
	'desktop/external-ffmpeg-installer.ts',
	'desktop/external-ffmpeg-video-verification.ts',
	'desktop/external-ffmpeg-video-canary-inspection.ts',
	'desktop/external-ffmpeg-video-verified-capabilities.ts',
	'desktop/external-ffmpeg-video-process.ts',
	'desktop/external-ffmpeg-video-operation-service.ts',
	'desktop/desktop-video-codec-registration.mjs',
	'src/common/editor/ui/dialogs/DesktopFfmpegPreferencePanel.tsx',
	'tests/desktop-external-ffmpeg-audio-operation-runner.test.ts',
	'tests/desktop-external-ffmpeg-installer.test.ts',
	'tests/external-ffmpeg-video-verification.test.ts',
	'tests/external-ffmpeg-video-canary-inspection.test.ts',
	'tests/external-ffmpeg-video-operation-service.test.ts',
	'tests/desktop-video-codec-registration.test.js',
];
const FRAMESCAPER_NATIVE_MEDIA_EVIDENCE = [
	'scripts/lib/desktop-codec-policy.mjs',
	'scripts/lib/framescaper-native-host-payload-staging.mjs',
	'tests/desktop-codec-policy.test.js',
	'tests/desktop-framescaper-native-host-payload-staging.test.js',
];

test('desktop codec controls retain framework, provider, and packaging evidence', async () => {
	const matrix = JSON.parse(await readFile(matrixUrl, 'utf8'));
	const risks = new Map(matrix.risks.map((risk) => [risk.id, risk]));
	const helperPayload = control(risks, 'native-helper-processes', 'verified-helper-engine-payload');
	const packageIntegrity = control(risks, 'runtime-supply-chain', 'desktop-fuse-and-package-integrity');

	assertEvidence(helperPayload, ELECTRON_EVIDENCE);
	assertEvidence(helperPayload, BUNDLED_CODEC_EVIDENCE);
	assertEvidence(helperPayload, OS_CODEC_EVIDENCE);
	assertEvidence(helperPayload, EXTERNAL_CODEC_EVIDENCE);
	assertEvidence(helperPayload, FRAMESCAPER_NATIVE_MEDIA_EVIDENCE);
	assertEvidence(helperPayload, [
		'src/common/editor/controller/export/internal/desktop-audio-export-capability.ts',
		'tests/audio-editor-desktop-export-capability.test.ts',
		'tests/audio-editor-desktop-export-codec-model.test.ts',
		'tests/audio-editor-desktop-export-dialog-capability.test.js',
	]);
	assertEvidence(packageIntegrity, [
		'.github/workflows/desktop-preview.yml',
		...ELECTRON_EVIDENCE,
		...BUNDLED_CODEC_EVIDENCE,
		...FRAMESCAPER_NATIVE_MEDIA_EVIDENCE,
		'scripts/lib/desktop-renderer-codec-audit.mjs',
		'scripts/lib/desktop-bundled-codec-notices.mjs',
		'scripts/lib/desktop-bundled-audio-codec-runtime-closure.mjs',
		'scripts/lib/desktop-bundled-codec-corresponding-source.mjs',
		'config/desktop-bundled-codec-corresponding-source.json',
		'desktop/external-ffmpeg-video-operation-service.ts',
		'scripts/desktop-prepare.mjs',
		'scripts/desktop-before-pack.mjs',
		'scripts/desktop-after-pack.mjs',
		'scripts/desktop-release-assets.mjs',
		'scripts/lib/desktop-os-audio-codec-native-package-verification.mjs',
		'scripts/lib/desktop-package-os-audio-codec-closure.mjs',
		'tests/desktop-packaged-ffmpeg-runtime.test.js',
		'tests/desktop-packaged-os-audio-codec-native.test.js',
		'tests/desktop-bundled-codec-notices.test.js',
		'tests/desktop-bundled-codec-corresponding-source.test.js',
		'tests/desktop-release-package-inventory.test.js',
	]);
});

function control(risks, riskId, controlId) {
	const found = risks.get(riskId)?.currentControls.find(({ id }) => id === controlId);
	assert.ok(found, `${riskId} must retain ${controlId}`);
	return found;
}

function assertEvidence(controlValue, paths) {
	for (const path of paths) {
		assert.ok(controlValue.evidence.some((item) => item.path === path), `${controlValue.id} needs ${path}`);
	}
}
