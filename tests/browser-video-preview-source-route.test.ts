/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import {
	createSourceFile,
	forEachChild,
	isCallExpression,
	isExportDeclaration,
	isImportDeclaration,
	isStringLiteral,
	ScriptKind,
	ScriptTarget,
	SyntaxKind,
	type Node,
} from 'typescript';

import { videoPreviewSourceResponse } from './browser/video-preview-source-route.js';

const ROUTE_ROOT = '/__video-preview-source-fixture__';
const SOURCE_ROOT = new URL(`${ROUTE_ROOT}/source/`, 'https://preview.invalid');
const COMPOSITOR = 'common/editor/ui/video-preview-compositor.js';

/** Follow browser-visible JavaScript after TS erasure, including literal lazy imports. */
function runtimeImports(body: string, pathname: string): string[] {
	const imports: string[] = [];
	function visit(node: Node): void {
		if (isImportDeclaration(node) || isExportDeclaration(node)) {
			const specifier = node.moduleSpecifier;
			if (specifier) {
				assert.ok(isStringLiteral(specifier), `${pathname}: nonliteral module import`);
				imports.push(specifier.text);
			}
		} else if (isCallExpression(node) && node.expression.kind === SyntaxKind.ImportKeyword) {
			assert.equal(node.arguments.length, 1, `${pathname}: unsupported dynamic import`);
			const specifier = node.arguments[0];
			assert.ok(specifier && isStringLiteral(specifier), `${pathname}: computed dynamic import`);
			imports.push(specifier.text);
		}
		forEachChild(node, visit);
	}
	visit(createSourceFile(pathname, body, ScriptTarget.ES2022, true, ScriptKind.JS));
	return imports;
}

test('the M4 fixture serves the complete production compositor runtime import graph', async () => {
	const pending: URL[] = [new URL(COMPOSITOR, SOURCE_ROOT)];
	const served = new Map<string, string>();
	while (pending.length) {
		const url = pending.pop();
		assert.ok(url);
		const modulePath = url.pathname.slice(SOURCE_ROOT.pathname.length);
		if (served.has(modulePath)) continue;
		const response = await videoPreviewSourceResponse(url.pathname, ROUTE_ROOT);
		assert.ok(response, `${modulePath}: missing source response`);
		assert.equal(response.contentType, 'text/javascript');
		served.set(modulePath, response.body);
		for (const specifier of runtimeImports(response.body, modulePath)) {
			assert.match(specifier, /^\.{1,2}\//u, `${modulePath}: only relative production imports`);
			const dependency: URL = new URL(specifier, url);
			assert.equal(dependency.origin, SOURCE_ROOT.origin);
			assert.ok(dependency.pathname.startsWith(SOURCE_ROOT.pathname),
				`${modulePath}: dependency escaped the fixture source root`);
			pending.push(dependency);
		}
	}
	for (const modulePath of [
		'common/editor/controller/clip-video/video-curves-gpu.ts',
		'common/editor/controller/clip-video/video-color-wheels-gpu.ts',
		'common/editor/controller/clip-video/video-global-develop-gpu.ts',
		'common/editor/controller/clip-video/internal/video-effect-lookup-gpu.ts',
		'common/editor/imaging/image-geometry-plan-v1.ts',
		'common/editor/ui/video-preview-effect-parameters.ts',
		'common/editor/ui/video-preview-noise-reduction-v1.ts',
	]) assert.ok(served.has(modulePath), `expected production dependency ${modulePath}`);
	const lookup = served.get('common/editor/controller/clip-video/internal/video-effect-lookup-gpu.ts');
	assert.ok(lookup);
	assert.match(lookup, /export function bindVideoEffectLookupGpu/u);
	assert.doesNotMatch(lookup, /interface Resource|WebGL2RenderingContext|Uint8Array<ArrayBuffer>/u);
});

test('the preview source fixture leaves unrelated routes to their caller', async () => {
	for (const pathname of [
		`${ROUTE_ROOT}/index.html`,
		`/other/source/${COMPOSITOR}`,
		`${ROUTE_ROOT}/source-other/${COMPOSITOR}`,
	]) assert.equal(await videoPreviewSourceResponse(pathname, ROUTE_ROOT), null);
});

test('the preview source fixture rejects unknown, neighboring and ambiguous module paths', async () => {
	for (const modulePath of [
		'common/editor/ui/video-preview-straight-rgba.ts',
		'common/editor/video-effects.js',
		'common/editor/missing.ts',
		'../../package.json',
		'common/editor/ui/../video-delivery-color.ts',
		'common/editor/%2e%2e/package.json',
		`${COMPOSITOR}?raw`,
		`${COMPOSITOR}#alias`,
	]) await assert.rejects(
		videoPreviewSourceResponse(`${SOURCE_ROOT.pathname}${modulePath}`, ROUTE_ROOT),
		{ message: `Unregistered video preview source module ${modulePath}.` },
	);
});
