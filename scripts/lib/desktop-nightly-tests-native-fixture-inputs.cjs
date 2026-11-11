/* SPDX-License-Identifier: AGPL-3.0-only */

const externalDisplaySources = require('./desktop-nightly-tests-external-display-inputs.cjs');
const keyingSourceInputs = require('./desktop-nightly-tests-keying-source-inputs.cjs');

// Browser fixtures bundle or inspect these maintained sources with their exact
// project-library-runtime aliases; no generated desktop runtime is required.
module.exports = Object.freeze([
	...externalDisplaySources,
	...keyingSourceInputs,
	'desktop/assistance-onnx-gpu-closure.ts',
	'desktop/assistance-acceleration-entrypoints.ts',
	'desktop/assistance-execution-providers.ts',
	'desktop/assistance-runtime-family-manifest.ts',
	'native/soundscaper-professional-host/tests/os_audio_codec_self_test.cpp',
	'desktop/preload.mjs',
	'desktop/update-preferences.ts',
	'desktop/desktop-database.ts',
	'desktop/local-storage-safety.ts',
	'desktop/local-storage-volume.ts',
	'desktop/assistance-sherpa-enhancement-contract.ts',
	'desktop/assistance-runtime-family-job-contract.ts',
	'desktop/project-saving-preload.ts',
	'desktop/save-target-preload.ts',
	'desktop/macro-batch-save.ts',
	'desktop/audiocom-authorization.ts',
	'desktop/audiocom-links.ts',
	'desktop/ara-preload.ts',
	'desktop/blender-preload.ts',
	'desktop/assistance-keyed-video-preload.ts',
	'src/common/editor/ara-contract.ts',
	'src/common/editor/blender-contract.ts',
	'vendor/audacity-design-system/components/src/component-copy.ts',
	'vendor/audacity-design-system/components/src/Icon/icon-codes.ts',
	'tests/helpers/audio-format-import-cases.ts',
	'tests/helpers/dawproject-foreign-route.ts',
	'tests/helpers/dawproject-master-route.ts',
	'tests/helpers/handbook-macro-programs.ts',
	'tests/helpers/matroska-metadata-custody-cases.ts',
	'tests/helpers/mp4-text-metadata-cases.ts',
	'tests/helpers/pcm-metadata-import-cases.ts',
	'tests/helpers/opus-padding-reference.ts',
]);
