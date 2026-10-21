/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import test from 'node:test';
import { LIGHTSCAPER_DESKTOP_NATIVE_CI_TARGETS_CURRENT_V1 as targets } from '../scripts/lib/lightscaper-desktop-native-ci-plan-current-v1.ts';

const root = new URL('../', import.meta.url), require = createRequire(import.meta.url);
const { load } = require('js-yaml') as { load: (source: string) => unknown };
const workflowPath = '.github/workflows/lightscaper-desktop-native-internal.yml';
function record(value: unknown): Record<string, unknown> {
	assert.ok(value && typeof value === 'object' && !Array.isArray(value)); return value as Record<string, unknown>;
}
async function text(path: string): Promise<string> { return readFile(new URL(path, root), 'utf8'); }
async function workflow(): Promise<Record<string, unknown>> { return record(load(await text(workflowPath))); }
function steps(value: unknown): Record<string, unknown>[] { assert.ok(Array.isArray(value)); return value.map(record); }

void test('internal Photo qualification consumes its own exact five-target producer before packaging', async () => {
	const value = await workflow(), on = record(value.on), jobs = record(value.jobs);
	assert.deepEqual(Object.keys(on).sort(), ['workflow_call', 'workflow_dispatch']);
	assert.deepEqual(value.permissions, { contents: 'read' });
	assert.equal(record(jobs['photo-native']).uses, './.github/workflows/lightscaper-photo-native-build.yml');
	const job = record(jobs.qualify), matrix = record(record(job.strategy).matrix);
	assert.equal(job.needs, 'photo-native'); assert.equal(record(job.strategy)['fail-fast'], false);
	assert.deepEqual(matrix.include, targets);
	assert.equal(job['runs-on'], '${{ matrix.runner }}');
	assert.ok(typeof job['timeout-minutes'] === 'number' && job['timeout-minutes'] <= 60);
	const all = steps(job.steps), download = all.find(step => String(step.uses).startsWith('actions/download-artifact@'));
	assert.ok(download); const withValue = record(download.with);
	assert.equal(withValue.name, 'lightscaper-photo-native-build-result-${{ matrix.target }}');
	assert.equal(withValue.path, '${{ runner.temp }}/lightscaper-photo-result');
	const checkout = all.find(step => String(step.uses).startsWith('actions/checkout@'));
	assert.equal(record(checkout?.with).ref, '${{ github.sha }}');
	const setup = all.find(step => String(step.uses).startsWith('actions/setup-node@'));
	assert.equal(record(setup?.with).architecture, '${{ matrix.node_arch }}');
	assert.equal(all.findIndex(step => step.uses === './.github/actions/setup-native-tooling') < all.findIndex(step => step.run === 'npm ci'), true);
	assert.ok(all.some(step => step.run === 'npm install --global npm@12.0.1'));
	for (const step of all) if (typeof step.uses === 'string' && step.uses.startsWith('actions/')) assert.match(step.uses, /@[a-f0-9]{40}$/u);
});

void test('internal workflow executes the complete public-package runner under native target hosts without release or sandbox shortcuts', async () => {
	const source = await text(workflowPath), job = record(record((await workflow()).jobs).qualify), all = steps(job.steps);
	const commands = all.filter(step => String(step.run).includes('scripts/lightscaper-desktop-native-qualification-current-v1.ts'));
	assert.equal(commands.length, 2, 'Linux uses Xvfb, macOS and Windows use their actual host display');
	for (const step of commands) {
		assert.match(String(step.run), /--target "\$LIGHTSCAPER_CI_TARGET"/u);
		assert.match(String(step.run), /--source-revision "\$GITHUB_SHA"/u);
		assert.match(String(step.run), /--native-result "\$RUNNER_TEMP\/lightscaper-photo-result"/u);
		assert.match(String(step.run), /--npm-cli "\$LIGHTSCAPER_CI_NPM_CLI"/u);
	}
	assert.ok(commands.some(step => String(step.run).includes('xvfb-run --auto-servernum')));
	assert.match(source, /LIGHTSCAPER_WINDOWS_JOB_HELPER/u);
	assert.match(source, /LIGHTSCAPER_WINDOWS_JOB_HELPER_SHA256/u);
	assert.doesNotMatch(source, /--allow-no-sandbox|--no-sandbox|continue-on-error|contents: write|gh release|desktop:publish:assistance/u);
	const upload = all.find(step => String(step.uses).startsWith('actions/upload-artifact@'));
	assert.ok(upload); assert.equal(upload.if, 'always()');
	assert.deepEqual(String(record(upload.with).path).trim().split('\n'), ['${{ runner.temp }}/lightscaper-photo-evidence', '${{ runner.temp }}/lightscaper-association-evidence']);
	assert.equal(record(upload.with)['if-no-files-found'], 'error');
});

void test('existing preview and nightly flows invoke a separate Photo owner without changing deferred release scope', async () => {
	const preview = record(load(await text('.github/workflows/desktop-preview.yml'))), nightly = record(load(await text('.github/workflows/desktop-nightly-tests.yml')));
	for (const value of [preview, nightly]) {
		const call = record(record(value.jobs)['lightscaper-internal-desktop']);
		assert.equal(call.uses, './' + workflowPath);
		assert.ok(String(call.if).includes("github.ref_type != 'tag'"));
	}
	const metadata = record(JSON.parse(await text('config/product-release-lines.json')) as unknown);
	assert.equal(record(record(metadata.products).lightscaper).releaseChannel, 'deferred');
	const previewSource = await text('.github/workflows/desktop-preview.yml');
	assert.doesNotMatch(previewSource, /'lightscaper-v\*/u);
	assert.match(previewSource, /\['soundscaper', 'framescaper'\]/u);
	const nightlySource = await text('scripts/desktop-nightly-tests-products.mjs');
	assert.doesNotMatch(nightlySource, /['"]lightscaper['"]/u);
});

void test('qualification runner authenticates final package bytes and uses actual joined process owners for both optional-service states', async () => {
	const source = await text('scripts/lightscaper-desktop-native-qualification-current-v1.ts');
	assert.match(source, /verifyDesktopLightscaperPackageReceiptCurrentV1/u);
	assert.match(source, /verifyLightscaperPhotoNativeBuildResultCurrentV1/u);
	assert.match(source, /launchLightscaperManagedSmokeProcessCurrentV1/u);
	assert.match(source, /launchLightscaperWindowsJobProcessCurrentV1/u);
	assert.match(source, /runLightscaperDesktopManagedSmokeCurrentV1/u);
	assert.match(source, /'run', 'desktop:dir'/u);
	assert.match(source, /LIGHTSCAPER_PHOTO_NATIVE_BUILD_RESULT/u);
	assert.match(source, /nativePhotoRuntime/u);
	assert.doesNotMatch(source, /--allow-no-sandbox|--no-sandbox|openAsBlob|execFileSync|spawnSync/u);
	assert.match(source, /readersRetired/u);
	assert.match(source, /workRetained/u);
});

void test('manual non-tag nightly feature dispatch admits only the separate internal Photo job', async () => {
	const source = await text('.github/workflows/desktop-nightly-tests.yml'), value = record(load(source));
	const on = record(value.on), jobs = record(value.jobs), photo = record(jobs['lightscaper-internal-desktop']);
	// This exact GitHub condition admits main and manual branch runs, while
	// excluding every tag and automatic non-main event. The other graph stays main-only.
	assert.equal(photo.if, "(github.ref == 'refs/heads/main' || github.event_name == 'workflow_dispatch') && github.ref_type != 'tag'");
	assert.equal(photo.uses, './' + workflowPath);
	assert.deepEqual(Object.keys(photo).sort(), ['if', 'uses']);
	assert.deepEqual(Object.keys(on).sort(), ['push', 'workflow_dispatch']);
	assert.deepEqual(on.push, { branches: ['main'] });
	assert.deepEqual(value.permissions, { contents: 'read', packages: 'read' });
	assert.deepEqual(Object.keys(jobs).sort(), ['browser-sites', 'lightscaper-internal-desktop', 'nightly-test-targets', 'package-with-tests']);
	assert.equal(record(jobs['nightly-test-targets']).if, "github.ref == 'refs/heads/main'");
	const browser = record(jobs['browser-sites']), packaged = record(jobs['package-with-tests']);
	assert.equal(browser.needs, 'nightly-test-targets');
	assert.equal(String(browser.if).replace(/\s+/gu, ' ').trim(), "!cancelled() && needs.nightly-test-targets.result == 'success'");
	assert.deepEqual(packaged.needs, ['nightly-test-targets', 'browser-sites']);
	assert.equal(String(packaged.if).replace(/\s+/gu, ' ').trim(),
		"!cancelled() && needs.nightly-test-targets.result == 'success' && needs.browser-sites.result == 'success'");
	assert.doesNotMatch(source, /desktop:publish:assistance-runtimes|R2_MODELS_ACCESS_KEY_ID|contents: write|secrets: inherit/u);
});

void test('all five internal target hosts build their real association helper and require actual native refusal fixtures', async () => {
	const all = steps(record(record((await workflow()).jobs).qualify).steps);
	const build = all.find(step => step.name === 'Build the target-native registered association helper');
	assert.ok(build); const command = String(build.run);
	assert.match(command, /native\/lightscaper-desktop-association-current-v1\/\$native_dir/u);
	for (const family of ['linux', 'mac', 'windows']) assert.ok(command.includes(`native_dir=${family}`));
	assert.match(command, /--target lightscaper-desktop-association-current-v1 --parallel 2/u);
	assert.match(command, /createHash\("sha256"\)/u);
	assert.match(command, /LIGHTSCAPER_ASSOCIATION_HELPER_SHA256/u);
	const linux = all.find(step => step.name === 'Execute actual Linux association native refusals');
	const mac = all.find(step => step.name === 'Execute actual macOS association native refusals');
	const windows = all.find(step => step.name === 'Execute actual Windows association native refusals in the real Job');
	assert.equal(linux?.if, "runner.os == 'Linux'"); assert.equal(mac?.if, "runner.os == 'macOS'"); assert.equal(windows?.if, "runner.os == 'Windows'");
	assert.equal(linux?.run, 'node --import tsx --test tests/lightscaper-desktop-association-linux-native-current.test.ts');
	assert.equal(mac?.run, 'node --import tsx --test tests/lightscaper-desktop-association-macos-current.test.ts');
	assert.equal(record(windows?.env).LIGHTSCAPER_WINDOWS_ASSOCIATION_NATIVE_REQUIRED, '1');
	assert.match(String(windows?.run), /lightscaper-desktop-windows-association-native-refusal-current\.test\.ts/u);
	assert.match(command, /LIGHTSCAPER_WINDOWS_ASSOCIATION_HELPER_SHA256/u);
	const apt = all.find(step => step.name === 'Prepare real Linux display and user namespaces');
	for (const dependency of ['libglib2.0-dev', 'pkg-config', 'desktop-file-utils', 'shared-mime-info', 'xdg-utils']) assert.ok(String(apt?.run).includes(dependency));
});
void test('installed association qualification invokes the real OS owner on every native target and retains both bounded evidence roots', async () => {
	const all = steps(record(record((await workflow()).jobs).qualify).steps);
	const commands = all.filter(step => String(step.run).includes('scripts/lightscaper-desktop-association-qualification-current-v1.ts'));
	assert.equal(commands.length, 2);
	assert.ok(commands.some(step => step.if === "runner.os == 'Linux'" && String(step.run).includes('xvfb-run --auto-servernum')));
	assert.ok(commands.some(step => step.if === "runner.os != 'Linux'"));
	for (const step of commands) {
		assert.match(String(step.run), /--target "\$LIGHTSCAPER_CI_TARGET"/u);
		assert.match(String(step.run), /--source-revision "\$GITHUB_SHA"/u);
		assert.match(String(step.run), /--association-helper "\$LIGHTSCAPER_ASSOCIATION_HELPER"/u);
		assert.match(String(step.run), /--association-helper-sha256 "\$LIGHTSCAPER_ASSOCIATION_HELPER_SHA256"/u);
		assert.match(String(step.run), /--npm-cli "\$LIGHTSCAPER_CI_NPM_CLI"/u);
		assert.ok(typeof step['timeout-minutes'] === 'number' && step['timeout-minutes'] <= 25);
	}
});

void test('Photo native artifact transport retains its authenticated hidden corresponding-source closure', async () => {
	const producer = record(load(await text('.github/workflows/lightscaper-photo-native-build.yml')));
	const all = steps(record(record(producer.jobs).build).steps);
	const uploads = all.filter(step => String(step.uses).startsWith('actions/upload-artifact@'));
	assert.equal(uploads.length, 1); const upload = record(uploads[0]?.with);
	assert.equal(upload.name, 'lightscaper-photo-native-build-result-${{ matrix.target }}');
	assert.equal(upload.path, '${{ runner.temp }}/lightscaper-photo-native-build/result');
	assert.equal(upload['if-no-files-found'], 'error');
	const manifest = record(JSON.parse(await text('native/lightscaper-photo-native-current-v1/source-manifest.json')) as unknown);
	assert.ok(Array.isArray(manifest.files));
	const hidden = manifest.files.filter((name): name is string => typeof name === 'string' && name.split('/').some(part => part.startsWith('.')));
	assert.ok(hidden.includes('.github/workflows/lightscaper-photo-native-build.yml'), 'The actual producer workflow is delivered corresponding source.');
	assert.equal(upload['include-hidden-files'], true, `Artifact upload must retain source/${hidden.join(', source/')}`);
});
