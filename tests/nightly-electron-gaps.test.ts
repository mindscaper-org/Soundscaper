/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';

const root = resolve(import.meta.dirname, '..');
const execFileAsync = promisify(execFile);
interface Suite { suites?: Suite[]; specs?: { title: string; file: string }[] }

async function collect(config: string): Promise<{ title: string; file: string }[]> {
	const { stdout } = await execFileAsync(process.execPath, [
		resolve(root, 'node_modules/@playwright/test/cli.js'), 'test', '--list', '--reporter=json', '--config', config,
	], { cwd: root, maxBuffer: 8 * 1024 ** 2, env: { ...process.env,
		SOUNDSCAPER_NIGHTLY_TESTS_PAYLOAD_ROOT: root,
		SOUNDSCAPER_NIGHTLY_TESTS_RUN_ROOT: resolve(root, 'test-results/nightly-collection'),
		SOUNDSCAPER_LOCAL_ASSISTANCE_REAL_MODELS: '1',
	} });
	const report = JSON.parse(stdout) as { suites: Suite[]; errors?: unknown[] };
	assert.deepEqual(report.errors ?? [], []);
	const visit = (suite: Suite): { title: string; file: string }[] => [
		...suite.specs ?? [], ...(suite.suites ?? []).flatMap(visit),
	];
	return report.suites.flatMap(visit);
}

test('nightly collects every real denoising port case for both packaged products without downloading models', async () => {
	const specs = (await collect('playwright.nightly-local-assistance.config.mjs'))
		.filter(spec => spec.file.endsWith('denoise-ports.spec.ts'));
	assert.equal(specs.length, 12, 'six rate/channel cases must run in each product');
	for (const rate of [48_000, 44_100, 96_000]) for (const channels of [1, 2]) {
		assert.equal(specs.filter(spec => spec.title.includes(`${channels} channels at ${rate} Hz`)).length, 2);
	}
});

test('nightly collects real packaged Web VCR capture alongside persistent delivery recovery', async () => {
	const specs = await collect('playwright.nightly-packaged-coverage.config.mjs');
	assert.equal(specs.filter(spec => spec.file.endsWith('desktop-packaged-web-vcr.spec.ts')).length, 1);
	assert.equal(specs.filter(spec => spec.file.endsWith('desktop-packaged-delivery-restart.spec.ts')).length, 1);
	assert.equal(specs.filter(spec => spec.title === 'recovers a real persistent delivery job in a packaged app with the native helper').length, 1);
});

test('nightly packaging stages the same-revision authenticated native helper before building its products', async () => {
	const workflow = await readFile(resolve(root, '.github/workflows/desktop-nightly-tests.yml'), 'utf8');
	const packaging = workflow.slice(workflow.indexOf('\n  package-with-tests:'));
	assert.match(workflow, /uses: \.\/\.github\/workflows\/soundscaper-professional-native-build\.yml/u);
	assert.match(packaging, /needs:.*professional-native-build/u);
	assert.match(packaging, /name: soundscaper-professional-native-build-result-\$\{\{ matrix\.target\.platform \}\}-\$\{\{ matrix\.target\.arch \}\}/u);
	const stage = packaging.indexOf('node scripts/stage-soundscaper-professional-native-build-result.mjs');
	const products = packaging.indexOf('node scripts/desktop-nightly-tests-products.mjs');
	assert.ok(stage >= 0 && stage < products, 'native authority must be staged before either product is packaged');
});
