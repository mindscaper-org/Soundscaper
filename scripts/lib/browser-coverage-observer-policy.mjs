/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { browserCoverageObserverPaths } from './browser-coverage-observer-routes.mjs';

/** Source guard for the finite shipped-UI corpus, not a general route exemption.
 * @param {string} testFile @param {string} source
 */
export function assertBrowserCoverageObserverSpec(testFile, source) {
	const paths = browserCoverageObserverPaths(testFile); if (!paths.length) return false;
	assert.match(source, /import \{ expect, test, installLightscaperGpuObserverRoute \} from '\.\/helpers\/browser-coverage-fixture\.js';/u);
	assert.match(source, /import \{ compileNativeImageHandoffScript \} from '\.\/helpers\/lightscaper-image-handoff-native-fixture\.js';/u);
	assert.doesNotMatch(source, /browserCoverage\s*:/u, 'built GPU UI must remain coverage enabled');
	assert.doesNotMatch(source, /contentType:\s*['"](?:application|text)\/(?:ecmascript|javascript)/u, 'unregistered executable route');
	assert.doesNotMatch(source, /<script\b|<[^>]+\s(?:on[a-z]+|srcdoc)\s*=|javascript:/iu, 'unregistered inline test executable');
	assert.equal([...source.matchAll(/\.route(?:FromHAR)?\s*\(/gu)].length, 1, 'only the separately authenticated WASM route is direct');
	assert.match(source, /page\.route\(manifest\.runtime\.url,/u);
	assert.match(source, /expect\(fixture\.wasm\.byteLength\)\.toBe\(manifest\.runtime\.byteLength\)/u);
	assert.match(source, /toBe\(manifest\.runtime\.sha256\)/u);
	const navigation = source.indexOf('await page.goto(resolveBrowserProductTestUrl(`/lightscaper/${locale}/`))');
	assert.ok(navigation >= 0, 'the real public built product must be navigated');
	const calls = [...source.matchAll(/await installLightscaperGpuObserverRoute\(page, (PROGRAM|BROKER), (program|maskedBroker)\.source\);/gu)];
	assert.equal(calls.length, paths.length, 'every exact test program is installed with its exclusion');
	assert.equal([...source.matchAll(/\binstallLightscaperGpuObserverRoute\s*\(/gu)].length, paths.length);
	for (const [index, path] of paths.entries()) {
		const symbol = index === 0 ? 'PROGRAM' : 'BROKER', body = index === 0 ? 'program' : 'maskedBroker';
		assert.ok(source.includes(`const ${symbol} = '${path}'`), 'exact closed observer path');
		const call = calls.find(value => value[1] === symbol && value[2] === body);
		assert.ok(call && call.index < navigation, 'all observer admission precedes the first real navigation');
	}
	assert.match(source, /expect\(program\.assets\)\.toEqual\(\[\]\)/u, 'no hidden executable child assets');
	if (paths.length > 1) assert.match(source, /expect\(maskedBroker\.assets\)\.toEqual\(\[\]\)/u);
	return true;
}
