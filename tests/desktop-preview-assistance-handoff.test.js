/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { extractJob, readWorkflow } from './helpers/workflow-jobs.js';

test('preview publishes all target AI archives once and packages the authenticated handoff', async () => {
	const workflow = await readWorkflow('desktop-preview.yml');
	const producer = extractJob(workflow, 'prepare-assistance-runtime-handoff');
	const publisher = extractJob(workflow, 'publish-assistance-runtime-handoff');
	const packager = extractJob(workflow, 'package');
	assert.match(publisher, /needs: \[quality, tests, prepare-assistance-runtime-handoff\]/u);
	assert.match(producer, /matrix:[\s\S]*?windows-2025[\s\S]*?windows-11-arm/u);
	for (const runner of ['windows-2025', 'windows-11-arm', 'macos-15', 'ubuntu-22.04', 'ubuntu-24.04-arm']) {
		assert.ok(producer.includes(`runner: ${runner}`), `${runner} must build its exact runtime archives`);
	}
	assert.match(producer, /if: matrix\.target\.platform != 'linux'[\s\S]*ci-build-os-audio-codec-host/u);
	assert.match(producer, /if: runner\.os == 'Linux'[\s\S]*ci-apt-install\.sh build-essential cmake/u);
	assert.match(producer, /node scripts\/desktop-prepare\.mjs/u);
	assert.match(publisher, /node scripts\/publish-assistance-runtime-handoff\.ts/u);
	assert.match(producer, /node scripts\/export-assistance-runtime-handoff\.mjs/u);
	assert.match(producer, /name: assistance-runtime-handoff-\$\{\{ matrix\.target\.platform \}\}-\$\{\{ matrix\.target\.arch \}\}/u);
	assert.match(publisher, /SOUNDSCAPER_SOURCE_REVISION: \$\{\{ github\.sha \}\}/u);
	assert.match(publisher, /R2_MODELS_ACCESS_KEY_ID: \$\{\{ secrets\.R2_MODELS_ACCESS_KEY_ID \}\}/u);
	assert.match(packager, /needs: \[quality, tests, publish-assistance-runtime-handoff, professional-native-build, milestone-5-native-audit-source\]/u);
	assert.match(packager, /Download the published AI runtime handoff/u);
	assert.match(packager, /SOUNDSCAPER_ASSISTANCE_RUNTIME_HANDOFF_ROOT:/u);
	assert.doesNotMatch(packager, /if: matrix\.target\.platform == 'win'/u);
	assert.match(packager, /SOUNDSCAPER_ASSISTANCE_RUNTIME_HANDOFF_ROOT: \$\{\{ github\.workspace \}\}\/\.native-build\/assistance-runtime-handoff/u);
	assert.match(packager, /node scripts\/publish-assistance-runtime-assets\.mjs --verify/u);
	assert.doesNotMatch(packager, /R2_MODELS_|desktop:publish:assistance-runtimes/u);
});
