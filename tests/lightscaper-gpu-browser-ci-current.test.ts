/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import type { PlaywrightTestConfig } from '@playwright/test';
import { createSourceFile, isArrowFunction, isCallExpression, isExpressionStatement, isPropertyAccessExpression, ScriptTarget } from 'typescript';
import { extractJob } from './helpers/workflow-jobs.js';
import { assertBrowserCoverageObserverSpec } from '../scripts/lib/browser-coverage-observer-policy.mjs';

type PreviewServerConfig = Exclude<NonNullable<PlaywrightTestConfig['webServer']>, unknown[]>;
const ROOT = new URL('../', import.meta.url);
const CONFIG = 'playwright.lightscaper-gpu.config.mjs';
const PROJECT = 'lightscaper-software-gpu';
const JOB = 'browser-lightscaper-gpu';
const FULL_STACK = 'lightscaper-develop-full-stack-current.spec.ts';
const SPECS = ['lightscaper-native-gpu-current.spec.js', 'lightscaper-develop-gpu-preview-current.spec.js',
	'lightscaper-native-gpu-colors-current.spec.js', 'lightscaper-develop-gpu-colors-current.spec.js',
	'lightscaper-native-gpu-lut-current.spec.js', 'lightscaper-develop-gpu-lut-current.spec.js',
	'lightscaper-native-gpu-geometry-current.spec.js', 'lightscaper-develop-gpu-geometry-current.spec.js',
	'lightscaper-native-gpu-optics-current.spec.js', 'lightscaper-develop-gpu-optics-current.spec.js',
	'lightscaper-optical-vignette-current.spec.js',
	'lightscaper-native-gpu-spatial-current.spec.js', 'lightscaper-develop-gpu-spatial-current.spec.js',
	'lightscaper-native-gpu-mask-blend-current.spec.js',
	'lightscaper-native-gpu-mask-context-current.spec.js',
	'lightscaper-native-gpu-mask-overlay-current.spec.js',
	'lightscaper-native-gpu-masked-context-integration-current.spec.js',
	FULL_STACK,
	'lightscaper-native-gpu-mask-numeric-refusal-current.spec.js',
	'lightscaper-native-gpu-mask-large-current.spec.js',
	'lightscaper-develop-gpu-mask-current.spec.js',
	'lightscaper-native-gpu-repair-current.spec.js',
	'lightscaper-native-gpu-repair-fault-current.spec.js',
	'lightscaper-native-gpu-repair-broker-current.spec.js',
	'lightscaper-native-gpu-repair-large-current.spec.js',
	'lightscaper-develop-gpu-repair-current.spec.js',
	'lightscaper-chromatic-aberration-current.spec.js', 'lightscaper-defringe-current.spec.js',
	'lightscaper-lens-distortion-current.spec.js', 'lightscaper-develop-dehaze.spec.js',
	'lightscaper-develop-grain.spec.js', 'lightscaper-develop-noise.spec.js', 'lightscaper-develop-texture.spec.js',
	'framescaper-cube-lut.spec.js', 'framescaper-corridorkey-matte-parity.spec.js', 'framescaper-global-develop-parity.spec.js',
	'framescaper-global-export-pipeline.spec.js', 'framescaper-image-geometry.spec.js',
	'framescaper-post-crop-vignette.spec.js', 'framescaper-spatial-develop-native.spec.js'];
const CAPABILITY_SPECS = new Set(['mask-blend', 'mask-context', 'mask-overlay', 'masked-context-integration',
	'mask-numeric-refusal', 'repair', 'repair-fault', 'repair-broker'].map(name => `lightscaper-native-gpu-${name}-current.spec.js`));
const OPTICAL = 'lightscaper-optical-vignette-current.spec.js';
const BYTE_SPECS = new Set([OPTICAL, 'lightscaper-chromatic-aberration-current.spec.js', 'lightscaper-defringe-current.spec.js',
	'lightscaper-lens-distortion-current.spec.js', ...['dehaze', 'grain', 'noise', 'texture'].map(name => `lightscaper-develop-${name}.spec.js`)]);
const NATIVE_UI_SPECS = new Set(['lightscaper-develop-gpu-mask-current.spec.js', 'lightscaper-develop-gpu-repair-current.spec.js']);
const IMAGE = 'mcr.microsoft.com/playwright:v1.62.1-noble@sha256:dcc5531e97840b9b5e794f2814476b21571c5124a3fca2267d73041f56e7580e';
const ACTIONS = new Map([
	['actions/checkout', 'de0fac2e4500dabe0009e67214ff5f5447ce83dd'],
	['actions/setup-node', '395ad3262231945c25e8478fd5baf05154b1d79f'],
	['actions/cache', '55cc8345863c7cc4c66a329aec7e433d2d1c52a9'],
	['actions/download-artifact', '3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c'],
	['actions/upload-artifact', '043fb46d1a93c77aae656e7c1c64a875d1fc6a0a'],
]);

test('Lightscaper software GPU project owns exactly color, LUT, geometry, optics, spatial, mask and repair conformance with verified independent Frame and Photo servers', async () => {
	const previous = { port: process.env.PLAYWRIGHT_LIGHTSCAPER_PORT, framePort: process.env.PLAYWRIGHT_FRAMESCAPER_PORT, origins: process.env.SCAPE_PLAYWRIGHT_PRODUCT_ORIGINS };
	process.env.PLAYWRIGHT_LIGHTSCAPER_PORT = '4380';
	process.env.PLAYWRIGHT_FRAMESCAPER_PORT = '4379';
	try {
		const imported = await import(new URL(CONFIG, ROOT).href) as { default: PlaywrightTestConfig };
		const config = imported.default;
		assert.equal(config.testDir, './tests/browser');
		assert.deepEqual(config.testMatch, SPECS);
		assert.equal(config.testIgnore, undefined, 'a second filter must not silently drop conformance cases');
		assert.equal(config.workers, 1);
		assert.equal(config.retries, 0, 'driver qualification must expose its first failure');
		assert.equal(config.use?.baseURL, 'http://127.0.0.1:4380');
		assert.equal(config.use?.serviceWorkers, 'block');
		assert.deepEqual(JSON.parse(process.env.SCAPE_PLAYWRIGHT_PRODUCT_ORIGINS ?? 'null') as unknown,
			{ framescaper: 'http://127.0.0.1:4379', lightscaper: 'http://127.0.0.1:4380' });
		const servers = config.webServer;
		assert.ok(Array.isArray(servers)); assert.equal(servers.length, 2);
		for (const [index, product, port] of [[0, 'framescaper', 4379], [1, 'lightscaper', 4380]] as const) {
			const server: PreviewServerConfig = servers[index]!;
			assert.equal(server.url, `http://127.0.0.1:${String(port)}/en/`);
			assert.ok(server.command.includes(`vite.js preview --outDir .wrangler/browser-products/${product} `));
			assert.ok(server.command.includes(`--host 127.0.0.1 --port ${String(port)} --strictPort`));
			assert.equal(server.reuseExistingServer, false);
		}
		assert.ok(config.projects);
		assert.equal(config.projects.length, 1);
		const project = config.projects[0]!;
		assert.equal(project.name, PROJECT);
		assert.equal(project.use?.browserName, 'chromium');
		assert.equal(project.testMatch, undefined);
		assert.equal(project.testIgnore, undefined);
		assert.deepEqual(project.use?.launchOptions?.args,
			['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader']);
		assert.equal(project.use?.launchOptions?.executablePath, undefined, 'use the lockfile-selected Playwright Chromium');
		assert.equal(project.use?.channel, undefined, 'a host-installed Chrome is not the pinned renderer');
	} finally {
		restore('PLAYWRIGHT_LIGHTSCAPER_PORT', previous.port);
		restore('PLAYWRIGHT_FRAMESCAPER_PORT', previous.framePort);
		restore('SCAPE_PLAYWRIGHT_PRODUCT_ORIGINS', previous.origins);
	}
});

for (const [workflowName, buildJob] of [['quality.yml', 'build']] as const) {
	test(`${workflowName} requires the pinned Lightscaper software GPU proof before its aggregate gate`, async () => {
		const workflow = await text(`.github/workflows/${workflowName}`);
		const job: string = extractJob(workflow, JOB);
		assert.match(job, new RegExp(`^ {4}needs: ${buildJob}$`, 'mu'));
		assert.match(job, /^ {4}runs-on: ubuntu-24\.04$/mu);
		assert.ok(job.includes(`image: ${IMAGE}`));
		assert.match(job, /^ {6}options: --user 1001$/mu);
		assert.doesNotMatch(job, /^ {4}(?:if|continue-on-error|strategy):/mu,
			'the finite conformance job must not be optional or expand across the ordinary suite');
		const uses = [...job.matchAll(/^ +uses: (actions\/[a-z-]+)@([^\s]+).*$/gmu)];
		assert.ok(uses.length >= 5);
		for (const [, action, pin] of uses) assert.equal(pin, ACTIONS.get(action!), `reuse the existing ${action} action pin`);
		assert.ok(uses.some(([, action]) => action === 'actions/checkout'));
		assert.ok(uses.some(([, action]) => action === 'actions/setup-node'));
		assert.match(job, /node-version-file: \.nvmrc/u);
		assert.match(job, /npm install --global --prefix "\$HOME\/\.local" npm@12\.0\.1/u);
		assert.match(job, /run: npm ci/u);

		const steps = job.split(/^ {6}- name: /mu).slice(1);
		const downloads = steps.filter(step => step.includes('uses: actions/download-artifact@'));
		assert.equal(downloads.length, 4, 'only the two verified sites and their sibling maps belong to this job');
		assert.deepEqual(downloads.map(step => /^ {10}name: (\S+)$/mu.exec(step)?.[1]),
			['verified-lightscaper-site-build', 'verified-lightscaper-site-source-maps', 'verified-framescaper-site-build', 'verified-framescaper-site-source-maps']);
		assert.match(downloads[0]!, /^ {10}path: \.wrangler\/browser-products\/lightscaper\/?$/mu);
		assert.match(downloads[1]!, /^ {10}path: \.wrangler\/browser-products\/lightscaper-source-maps\/?$/mu);
		assert.match(downloads[2]!, /^ {10}path: \.wrangler\/browser-products\/framescaper\/?$/mu);
		assert.match(downloads[3]!, /^ {10}path: \.wrangler\/browser-products\/framescaper-source-maps\/?$/mu);
		const verification = steps.find(step => step.includes("verifyBrowserProductSite(browserProductSiteForBuild('lightscaper'), { sourceMaps: true })"));
		assert.ok(verification, 'downloaded bytes must be authenticated before the server starts');
		assert.ok(verification.includes("'./scripts/lib/browser-product-site-plan.mjs'"));
		assert.ok(verification.includes("'./scripts/lib/browser-product-test-sites.mjs'"));
		assert.ok(verification.includes("verifyBrowserProductSite(browserProductSiteForBuild('lightscaper'), { sourceMaps: true })"));
		const run = steps.find(step => step.includes('npx playwright test'));
		assert.ok(run);
		assert.match(run, new RegExp(`^ +run: npx playwright test --config=${CONFIG.replaceAll('.', '\\.')} --project=${PROJECT} --workers=1$`, 'mu'));
		assert.ok(steps.indexOf(downloads[1]!) < steps.indexOf(verification));
		assert.ok(steps.indexOf(verification) < steps.indexOf(run));
		const frameVerification = steps.find(step => step.includes("verifyBrowserProductSite(browserProductSiteForBuild('framescaper'), { sourceMaps: true })"));
		assert.ok(frameVerification);
		assert.ok(steps.indexOf(downloads[3]!) < steps.indexOf(frameVerification));
		assert.ok(steps.indexOf(frameVerification) < steps.indexOf(run));
		assert.doesNotMatch(job, /npm run test:browser:built|playwright install|--shard|--grep|--pass-with-no-tests|provision-|build:browser:/u);
		assert.doesNotMatch(run, /continue-on-error|if:/u);
		assert.match(run, /^ {8}env:\n {10}SCAPE_BROWSER_COVERAGE: '1'$/mu,
			'actual interactive GPU owners must contribute their browser execution to the coverage union');
		const compact = steps.find(step => step.includes('npm run coverage:compact:browser'));
		assert.ok(compact);
		assert.match(compact, /^ {8}run: npm run coverage:compact:browser -- coverage\/shards\/browser-chromium-lightscaper-gpu\.json$/mu);
		assert.doesNotMatch(compact, /^ {8}(?:if|continue-on-error):/mu);
		const coverageUpload = steps.find(step => /^ {10}name: coverage-shard-browser-chromium-lightscaper-gpu$/mu.test(step));
		assert.ok(coverageUpload);
		assert.ok(coverageUpload.includes('uses: actions/upload-artifact@'));
		assert.match(coverageUpload, /^ {10}path: coverage\/shards\/browser-chromium-lightscaper-gpu\.json$/mu);
		assert.match(coverageUpload, /^ {10}if-no-files-found: error$/mu);
		assert.doesNotMatch(coverageUpload, /^ {8}(?:if|continue-on-error):/mu);
		assert.ok(steps.indexOf(run) < steps.indexOf(compact));
		assert.ok(steps.indexOf(compact) < steps.indexOf(coverageUpload));
		assert.match(extractJob(workflow, 'coverage'), /pattern: coverage-shard-\*/u,
			'the existing aggregate must download the new distinct native GPU shard');
		const diagnostics = steps.find(step => /^ {10}name: browser-diagnostics-lightscaper-software-gpu$/mu.test(step));
		assert.ok(diagnostics);
		assert.ok(diagnostics.includes('uses: actions/upload-artifact@'));
		assert.match(diagnostics, /^ {8}if: always\(\)$/mu);
		assert.match(diagnostics, /^ {10}name: browser-diagnostics-lightscaper-software-gpu$/mu);
		assert.ok(diagnostics.includes('playwright-report/')); assert.ok(diagnostics.includes('test-results/'));
		const coverage = extractJob(workflow, 'coverage');
		assert.match(coverage, new RegExp(`^ {4}needs: \\[[^\\]\\n]*\\b${JOB}\\b[^\\]\\n]*\\]$`, 'mu'),
			'the established aggregate status must fail/skip when software GPU proof fails');
	});
}

test('desktop preview delegates browser GPU and combined coverage qualification to quality.yml', async () => {
	const workflow = await text('.github/workflows/desktop-preview.yml');
	const quality = extractJob(workflow, 'quality'), tests = extractJob(workflow, 'tests');
	assert.match(quality, /# The Node suite runs in the per-product `tests` shards below\. Browser\n\s+# testing and combined coverage enforcement belong to quality\.yml\./u);
	assert.match(quality, /^ {8}run: npm run check:static$/mu);
	assert.match(tests, /^ {4}needs: quality$/mu);
	assert.match(tests, /run: xvfb-run --auto-servernum npm run test -- --shard=\$\{\{ matrix\.shard \}\}/u);
	assert.doesNotMatch(workflow, /^ {2}(?:browser(?:-[a-z-]+)?|firefox|coverage):$/mu,
		'the deliberate desktop nightly policy does not duplicate browser or combined coverage jobs');
	assert.doesNotMatch(workflow, /^ +run:.*(?:npx playwright test|npm run test:browser|npm run coverage:check)/mu);
	assert.match(extractJob(workflow, 'package'), /^ {4}needs: \[quality, tests,/mu,
		'desktop packaging still depends on its canonical static and actual Node gates');
});

for (const spec of SPECS) test(`${spec} preserves its declared native or capability/fallback qualification`, async () => {
	const source = await text(`tests/browser/${spec}`);
	const ast = createSourceFile(spec, source, ScriptTarget.ESNext, true);
	const calls = ast.statements.filter(isExpressionStatement).map(statement => statement.expression).filter(isCallExpression);
	const guards = calls.filter(call => isPropertyAccessExpression(call.expression)
		&& call.expression.expression.getText(ast) === 'test' && call.expression.name.text === 'skip');
	if (BYTE_SPECS.has(spec) || spec.startsWith('framescaper-')) {
		assert.equal(guards.length, 0);
		assert.match(source, /requireNativeGpuCapabilityCurrentV1\(page, (?:test\.info\(\)|info), 'webgl2'\)/u);
		if (spec === 'framescaper-cube-lut.spec.js') assert.match(source, /resource controls remain behind the existing Clip properties menu/u);
		if (spec === 'framescaper-corridorkey-matte-parity.spec.js') {
			assert.match(source, /expect\(metrics\)\.toHaveLength\(4\)/u);
			assert.match(source, /expect\(maximumError, JSON\.stringify\(metrics\)\)\.toBeLessThanOrEqual\(1\)/u);
			assert.ok(source.includes('test.use({ browserCoverage: false })'));
		}
		return;
	}
	if (CAPABILITY_SPECS.has(spec) || NATIVE_UI_SPECS.has(spec)) {
		assert.equal(guards.length, 0, 'ordinary native proof is admitted by actual capability, not a browser name');
		const beforeEach = calls.find(call => call.expression.getText(ast) === 'test.beforeEach');
		assert.ok(beforeEach);
		assert.match(beforeEach.getText(ast), /await requireNativeGpuCapabilityCurrentV1\(page, info\)/u);
		assert.doesNotMatch(source, /browserName !== 'firefox'/u);
	} else if (spec === FULL_STACK) {
		assert.equal(guards.length, 0, 'resource refusal and pre-draw cancellation remain all-engine cases');
		assert.match(source, /if \(fault === 'none' \|\| fault === 'held-consumer-abort'\) await requireNativeGpuCapabilityCurrentV1\(page, test\.info\(\)\)/u);
		assert.match(source, /test\('Current4 numerical repair boundary[\s\S]*?await requireNativeGpuCapabilityCurrentV1\(page, test\.info\(\)\)/u);
	} else if (spec === OPTICAL) {
		assert.equal(guards.length, 0);
		assert.match(source, /requireNativeGpuCapabilityCurrentV1\(page, test\.info\(\), 'webgl2'\)/u);
		assert.equal((source.match(/await nativeCapability\(page\)/gu) ?? []).length, 2);
		assert.match(source, /expect\(value\.nativeWebgl2\)\.toBe\(true\)/u);
	} else {
		assert.equal(guards.length, 1, 'use one declarative project guard before any suite fixture preparation');
		const guard = guards[0]!, body = guard.arguments[0];
		assert.ok(body && isArrowFunction(body));
		assert.equal(body.parameters.length, 1, 'Playwright modifiers receive only their fixture argument');
		const beforeAll = calls.find(call => isPropertyAccessExpression(call.expression) && call.expression.getText(ast) === 'test.beforeAll');
		const preparation = beforeAll ?? calls.find(call => call.expression.getText(ast) === 'test');
		assert.ok(preparation && guard.pos < preparation.pos, 'project admission precedes fixture preparation or direct test registration');
		for (const [browserName, project, skipped] of [
			['chromium', PROJECT, false], ['firefox', 'firefox', false],
			['chromium', 'chromium', true], ['webkit', 'webkit', true], ['chromium', 'unqualified-chromium', true],
		] as const) {
			let infoReads = 0;
			const callback: unknown = runInNewContext(`(${body.getText(ast)})`, {
				test: { info() { infoReads++; return { project: { name: project } }; } },
			});
			assert.equal(typeof callback, 'function');
			// Installed Playwright invokes modifier.fn(fixtures), unlike a test body.
			// Project metadata comes from the supported test.info() capability.
			assert.equal(Reflect.apply(callback as (...args: unknown[]) => unknown, undefined, [{ browserName }]),
				skipped, `${browserName}/${project} project admission`);
			assert.equal(infoReads, 1);
		}
	}
	if (spec !== OPTICAL) assert.ok(source.includes("toContain('SwiftShader')"), 'actual native software renderer identity remains asserted');
	if (spec === FULL_STACK) {
		assert.match(source, /test\('Current4 genuine RAW, Clone, color, LUT, masks and geometry deliver actual GPU pixels',[\s\S]*?const result = await run\(page, 'canonical', 'none', true\);\s*expect\(result\.rejected\)\.toBe\(false\); expect\(result\.callbacks\)\.toBe\(1\); gpu\(result, page\);/u,
			'the combined positive control unconditionally requires accepted GPU delivery after real RAW decoding');
		assert.match(source, /function gpu\(result: Result, page: Page\)[\s\S]*?expect\(result\.delivery\?\.backend\)\.toBe\('webgl2'\); expect\(result\.delivery\?\.reason\)\.toBeNull\(\); expect\(result\.delivery\?\.actualReadback\)\.toBe\(true\);/u);
		assert.match(source, /expect\(result\.delivery\?\.comparison\.mismatches, JSON\.stringify\(result\.delivery\?\.comparison\)\)\.toBe\(0\)/u,
			'accepted combined GPU pixels still require the independent exact CPU comparison');
		assert.match(source, /page\.context\(\)\.browser\(\)\?\.browserType\(\)\.name\(\) === 'chromium'/u,
			'the combined corpus checks its actual browser renderer rather than a synthetic browser flag');
	} else if (CAPABILITY_SPECS.has(spec) || NATIVE_UI_SPECS.has(spec)) assert.ok(source.includes("test.info().project.name === 'lightscaper-software-gpu'"));
	else if (spec !== OPTICAL) assert.ok(source.includes("browserName === 'chromium'") || /if \(positive\b[\s\S]{0,180}?expect\(value\.backend(?:,\s*(?:deliveryDiagnostic\(value\)|value\.reason))?\)\.toBe\('webgl2'\)/u.test(source),
		'the qualified Chromium path must demand actual GPU execution for its positive corpus');
	if (spec.startsWith('lightscaper-native-gpu') || spec === FULL_STACK || spec === OPTICAL) {
		assert.ok(source.includes('browserCoverage: false'), 'the lower component cancellation corpus retains its timing-sensitive opt-out');
	} else {
		assert.doesNotMatch(source, /browserCoverage\s*:/u, 'the interactive UI workflow uses default Chromium coverage');
		assert.equal(assertBrowserCoverageObserverSpec(spec, source), true, 'only exact source-attested test programs are excluded');
	}
});

async function text(path: string): Promise<string> { return readFile(new URL(path, ROOT), 'utf8'); }
function restore(key: string, value: string | undefined): void { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
