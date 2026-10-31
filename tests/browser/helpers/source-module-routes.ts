/* SPDX-License-Identifier: AGPL-3.0-only */

import { readFile } from 'node:fs/promises';
import { extname, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { transform } from 'esbuild';
import ts from 'typescript';

export interface TranspiledSourceRoute {
	readonly body: string;
	readonly contentType: 'text/javascript';
}

const TYPED_SOURCE = new Map([['.js', '.ts'], ['.jsx', '.tsx'], ['.mjs', '.mts'], ['.cjs', '.cts']]);

function withinRoot(url: URL, root: URL): string {
	const file = relative(fileURLToPath(root), fileURLToPath(url));
	if (file === '..' || file.startsWith(`..${sep}`)) throw new Error(`Module ${url.href} is outside the declared source root.`);
	return file.split(sep).join('/');
}

async function sourceUrl(input: URL): Promise<URL> {
	const url = new URL(input);
	url.search = '';
	url.hash = '';
	const extension = extname(url.pathname);
	const typedExtension = TYPED_SOURCE.get(extension);
	if (!typedExtension) return url;
	const typed = new URL(url.href.slice(0, -extension.length) + typedExtension);
	try { await readFile(typed, 'utf8'); return typed; }
	catch (error) {
		if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
		return url;
	}
}

function runtimeImports(code: string): readonly string[] {
	const source = ts.createSourceFile('module.js', code, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
	const specifiers = new Set<string>();
	const add = (value: ts.Node | undefined): void => {
		if (value && ts.isStringLiteralLike(value) && value.text.startsWith('.')) specifiers.add(value.text);
	};
	const visit = (node: ts.Node): void => {
		if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) add(node.moduleSpecifier);
		if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) add(node.arguments[0]);
		ts.forEachChild(node, visit);
	};
	visit(source);
	return [...specifiers];
}

/** Serve the real runtime import closure without assuming every owner lives in editor/. */
export async function transpileSourceModuleRoutes(
	sourceRoot: URL,
	routePrefix: string,
	entryPoints: readonly URL[],
): Promise<Map<string, TranspiledSourceRoute>> {
	const pending = [...entryPoints];
	const discovered = new Map<string, TranspiledSourceRoute>();
	while (pending.length) {
		const input = pending.pop()!;
		withinRoot(input, sourceRoot);
		const url = await sourceUrl(input);
		if (discovered.has(url.href)) continue;
		const filename = fileURLToPath(url);
		const extension = extname(filename);
		const transformed = await transform(await readFile(url, 'utf8'), {
			sourcefile: filename,
			loader: extension === '.tsx' ? 'tsx' : ['.ts', '.mts', '.cts'].includes(extension) ? 'ts' : extension === '.jsx' ? 'jsx' : 'js',
			format: 'esm', target: 'es2022', sourcemap: 'inline',
		});
		discovered.set(url.href, { body: transformed.code, contentType: 'text/javascript' });
		for (const specifier of runtimeImports(transformed.code)) pending.push(new URL(specifier, url));
	}
	const routes = new Map<string, TranspiledSourceRoute>();
	for (const [href, descriptor] of discovered) {
		const route = `${routePrefix.replace(/\/$/u, '')}/${withinRoot(new URL(href), sourceRoot)}`;
		routes.set(route, descriptor);
		for (const [javascript, typed] of TYPED_SOURCE) if (route.endsWith(typed)) routes.set(route.slice(0, -typed.length) + javascript, descriptor);
	}
	return routes;
}
