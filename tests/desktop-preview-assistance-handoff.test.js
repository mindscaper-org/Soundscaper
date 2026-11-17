/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import { extractJob, readWorkflow } from './helpers/workflow-jobs.js';

test('preview publishes all target AI archives once and packages the authenticated handoff', async () => {
	const workflow = await readWorkflow('desktop-preview.yml');
	const producer = extractJob(workflow, 'prepare-assistance-runtime-handoff');
	const preparation = extractJob(await readWorkflow('desktop-assistance-runtimes.yml'), 'prepare');
	const publisher = extractJob(workflow, 'publish-assistance-runtime-handoff');
	const packager = extractJob(workflow, 'package');
	assert.match(publisher, /needs: \[quality, tests, prepare-assistance-runtime-handoff\]/u);
	assert.match(producer, /matrix:[\s\S]*?windows-2025[\s\S]*?windows-11-arm/u);
	for (const runner of ['windows-2025', 'windows-11-arm', 'macos-15', 'ubuntu-22.04', 'ubuntu-24.04-arm']) {
		assert.ok(producer.includes(`runner: ${runner}`), `${runner} must build its exact runtime archives`);
	}
	assert.doesNotMatch(producer, /ci-build-os-audio-codec-host/u);
	assert.match(producer, /uses: \.\/\.github\/workflows\/desktop-assistance-runtimes\.yml/u);
	assert.match(preparation, /if: runner\.os == 'Linux'[\s\S]*ci-apt-install\.sh build-essential cmake/u);
	assert.match(preparation, /node scripts\/prepare-assistance-runtimes\.mjs/u);
	assert.match(publisher, /node scripts\/publish-assistance-runtime-handoff\.ts/u);
	assert.match(preparation, /node scripts\/export-assistance-runtime-handoff\.mjs/u);
	assert.match(preparation, /name: \$\{\{ inputs\.handoff-artifact-prefix \}\}-\$\{\{ fromJSON\(inputs\.target\)\.platform \}\}-\$\{\{ fromJSON\(inputs\.target\)\.arch \}\}/u);
	assert.match(publisher, /SOUNDSCAPER_SOURCE_REVISION: \$\{\{ github\.sha \}\}/u);
	assert.match(publisher, /R2_MODELS_ACCESS_KEY_ID: \$\{\{ secrets\.R2_MODELS_ACCESS_KEY_ID \}\}/u);
	assert.match(packager, /needs: \[quality, tests, publish-assistance-runtime-handoff, professional-native-build, milestone-5-native-audit-source\]/u);
	const packageSteps = packager.split(/^ {6}- name: /mu);
	for (const [name, contract] of [
		['Download the published AI runtime handoff', /name: assistance-runtime-handoff-\$\{\{ matrix\.target\.platform \}\}-\$\{\{ matrix\.target\.arch \}\}/u],
		['Stage the offline renderer and runtimes', /SOUNDSCAPER_ASSISTANCE_RUNTIME_HANDOFF_ROOT: \$\{\{ github\.workspace \}\}\/\.native-build\/assistance-runtime-handoff/u],
		['Verify published optional AI runtimes', /node scripts\/publish-assistance-runtime-assets\.mjs --verify/u],
	]) {
		const step = packageSteps.find(candidate => candidate.startsWith(`${name}\n`));
		assert.ok(step, `missing package step: ${name}`);
		assert.match(step, contract);
		assert.doesNotMatch(step, /^ {8}if:/mu, `${name} must run on every package target`);
	}
	assert.doesNotMatch(packager, /R2_MODELS_|desktop:publish:assistance-runtimes/u);
});
