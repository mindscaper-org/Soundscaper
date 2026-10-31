/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { extractJob } from './helpers/workflow-jobs.js';

function commandStep(source: string, command: string): string {
	const lines = source.split('\n');
	const index = lines.findIndex(line => line.includes(command));
	assert.ok(index >= 0, `Workflow does not invoke ${command}.`);
	let start = index;
	while (start >= 0 && !/^\s+- (?:name|uses):/u.test(lines[start]!)) start--;
	assert.ok(start >= 0);
	const indentation = lines[start]!.match(/^\s*/u)![0].length;
	let end = start + 1;
	while (end < lines.length && !(lines[end]!.startsWith(`${' '.repeat(indentation)}- `))) end++;
	return lines.slice(start, end).join('\n');
}

test('Every native Motion target produces an independently bound reference decoder', async () => {
	const workflow = await readFile(new URL('../.github/workflows/motionscaper-media-host-native-build.yml', import.meta.url), 'utf8');
	const build = extractJob(workflow, 'build');
	const decoder = commandStep(build, 'scripts/motionscaper-reference-artifact-build.ts');
	assert.doesNotMatch(decoder, /if:.*runner\.os/u, 'The independent oracle is required on Windows and macOS too.');
	assert.match(decoder, /--target=\$\{\{ matrix\.target \}\}/u);
	assert.match(decoder, /--prefix-authority=/u);
	assert.match(decoder, /--prefix-authority-sha256=.*steps\.reference-prefix\.outputs\.sha256/u);
	const authority = commandStep(build, 'scripts/motionscaper-reference-prefix-authority.ts');
	assert.doesNotMatch(authority, /if:.*runner\.os/u);
	assert.match(authority, /id: reference-prefix/u);
	assert.ok(build.indexOf('scripts/verify-motionscaper-native-build-result.mjs') < build.indexOf('scripts/motionscaper-reference-prefix-authority.ts'));
	assert.ok(build.indexOf('scripts/motionscaper-reference-prefix-authority.ts') < build.indexOf('scripts/motionscaper-reference-artifact-build.ts'));
	const retained = commandStep(build, 'name: motionscaper-reference-decoder-${{ matrix.target }}');
	assert.doesNotMatch(retained, /if:.*runner\.os/u);
	assert.match(retained, /if-no-files-found: error/u);
});

test('Candidate and nightly uploads wait for native Windows and macOS workflow qualification', async () => {
	for (const [file, job] of [['motionscaper-desktop-preview.yml', 'package'], ['desktop-nightly-tests.yml', 'package-with-tests']] as const) {
		const workflow = await readFile(new URL(`../.github/workflows/${file}`, import.meta.url), 'utf8');
		const body = extractJob(workflow, job);
		const qualifier = commandStep(body, 'uses: ./.github/actions/motionscaper-desktop-qualification');
		assert.match(qualifier, /if: runner\.os != 'Linux'/u);
		assert.doesNotMatch(qualifier, /continue-on-error/u);
		assert.match(qualifier, /native-result:.*motionscaper-native-build-result/u);
		assert.match(qualifier, /target:.*matrix\.target/u);
		assert.ok(body.indexOf('uses: ./.github/actions/motionscaper-desktop-qualification') < body.indexOf('uses: actions/upload-artifact@'));
	}
});

test('The portable gate prepares a target-native successor and retains the complete workflow evidence', async () => {
	const action = await readFile(new URL('../.github/actions/motionscaper-desktop-qualification/action.yml', import.meta.url), 'utf8');
	assert.match(action, /SCAPE_FRAMESCAPER_LINE: successor/u);
	assert.match(action, /SCAPE_FRAMESCAPER_DESKTOP_PROFILE: framescaper-successor-v2/u);
	assert.match(action, /FRAMESCAPER_SUCCESSOR_NATIVE_BUILD_RESULT: \$\{\{ inputs\.native-result \}\}/u);
	assert.match(action, /SOUNDSCAPER_SOURCE_REVISION: \$\{\{ github\.sha \}\}/u);
	assert.match(action, /electron-builder\.framescaper-successor\.cjs/u);
	assert.match(action, /--publish never/u);
	assert.match(action, /node scripts\/motionscaper-desktop-qualification\.ts/u);
	for (const argument of ['target', 'native-result', 'decoder-artifact', 'motion-stage', 'motion-package', 'successor-stage', 'successor-package', 'output']) {
		assert.ok(action.includes(`--${argument}=`), `The portable gate omits --${argument}.`);
	}
	assert.match(action, /if: always\(\)/u);
	assert.doesNotMatch(action, /continue-on-error|--no-sandbox|--publish always/u);
});
