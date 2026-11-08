/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { assertBrowserCoverageObserverSpec } from '../scripts/lib/browser-coverage-observer-policy.mjs';
const SPEC = 'lightscaper-develop-gpu-colors-current.spec.js';
const INSTALL = 'await installLightscaperGpuObserverRoute(page, PROGRAM, program.source);';
const NAVIGATE = 'await page.goto(resolveBrowserProductTestUrl(`/lightscaper/${locale}/`));';
const SOURCE = [
	"import { expect, test, installLightscaperGpuObserverRoute } from './helpers/browser-coverage-fixture.js';",
	"import { compileNativeImageHandoffScript } from './helpers/lightscaper-image-handoff-native-fixture.js';",
	"const PROGRAM = '/__lightscaper_develop_gpu_colors_current.js';",
	'expect(program.assets).toEqual([]);',
	'expect(fixture.wasm.byteLength).toBe(manifest.runtime.byteLength);',
	'expect(sha).toBe(manifest.runtime.sha256);',
	'await page.route(manifest.runtime.url, () => undefined);', INSTALL, NAVIGATE,
].join('\n');

test('source policy permits only the finite exact source-attested observer installer with built UI coverage', () => {
	assert.equal(assertBrowserCoverageObserverSpec(SPEC, SOURCE), true);
	assert.equal(assertBrowserCoverageObserverSpec('other.spec.js', SOURCE), false);
});

test('source policy refuses built path, extra direct executable, missing native checksum or specwide optout', () => {
	for (const source of [
		SOURCE.replace('/__lightscaper_develop_gpu_colors_current.js', '/assets/editor.js'),
		SOURCE + "\nawait page.route('**/*', () => undefined);",
		SOURCE + "\nconst handler = { contentType: 'text/javascript' };",
		SOURCE.replace('expect(sha).toBe(manifest.runtime.sha256);', ''),
		SOURCE + '\ntest.use({ browserCoverage: false });',
		SOURCE + '\nconst html = "<script>program()</script>";',
	]) assert.throws(() => assertBrowserCoverageObserverSpec(SPEC, source));
});

test('source policy refuses missing or late observer installation and replacement UI navigation', () => {
	for (const source of [SOURCE.replace(INSTALL, ''),
		SOURCE.replace(INSTALL, '').replace(NAVIGATE, NAVIGATE + '\n' + INSTALL),
		SOURCE.replace(NAVIGATE, "await page.goto('/__replacement_ui.html');")]) {
		assert.throws(() => assertBrowserCoverageObserverSpec(SPEC, source));
	}
});
