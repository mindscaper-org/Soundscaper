/* SPDX-License-Identifier: AGPL-3.0-only */

const externalDisplaySources = require('./desktop-nightly-tests-external-display-inputs.cjs');
const lightscaperSources = require('./desktop-nightly-tests-lightscaper-inputs.cjs');
const keyingSourceInputs = require('./desktop-nightly-tests-keying-source-inputs.cjs');

// Browser fixtures bundle or inspect these maintained sources with their exact
// project-library-runtime aliases; no generated desktop runtime is required.
module.exports = Object.freeze([
	...externalDisplaySources,
	...lightscaperSources,
	...keyingSourceInputs,
	'native/soundscaper-professional-host/tests/os_audio_codec_self_test.cpp',
	'desktop/preload.mjs',
	'desktop/audiocom-authorization.ts',
	'desktop/audiocom-links.ts',
	'desktop/ara-preload.ts',
	'desktop/blender-preload.ts',
	'desktop/assistance-keyed-video-preload.ts',
	'src/common/editor/ara-contract.ts',
	'src/common/editor/blender-contract.ts',
	'vendor/audacity-design-system/components/src/component-copy.ts',
	'vendor/audacity-design-system/components/src/TimeCode/time-code-musical-context.ts',
]);
