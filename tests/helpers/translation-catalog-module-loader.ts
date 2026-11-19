/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import ts from 'typescript';
import type { createTranslationCatalogBundlePlugin } from '../../scripts/lib/translation-catalog-bundle.mjs';

export interface TranslationCatalogDependency {
	readonly specifier: string;
	readonly id: string;
	readonly source: string;
}

/** Resolve the actual plugin graph before evaluating its generated modules. */
export async function loadBundledTranslationCatalogModule(
	plugin: ReturnType<typeof createTranslationCatalogBundlePlugin>,
	source: string,
	owner: string,
	onDependency?: (dependency: TranslationCatalogDependency) => void | Promise<void>,
): Promise<Record<string, unknown>> {
	const urls = new Map<string, Promise<string>>();
	async function materialize(text: string, importer: string): Promise<string> {
		const syntax = ts.createSourceFile('translation-catalog-generated.mjs', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
		const references: Array<Readonly<{ specifier: string; start: number; end: number }>> = [];
		const visit = (node: ts.Node): void => {
			const literal = ts.isImportDeclaration(node) || ts.isExportDeclaration(node) ? node.moduleSpecifier
				: ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword ? node.arguments[0] : undefined;
			if (literal && ts.isStringLiteralLike(literal)) references.push({ specifier: literal.text,
				start: literal.getStart(syntax), end: literal.getEnd() });
			ts.forEachChild(node, visit);
		};
		visit(syntax);
		const edits: Array<Readonly<{ start: number; end: number; replacement: string }>> = [];
		for (const reference of references) {
			const { specifier } = reference;
			if (!(specifier.startsWith('\0scape:translation-catalog-part:')
				|| specifier === 'scape:translation-source-text' || specifier.startsWith('scape:translation-locale-text:'))) continue;
			const id = plugin.resolveId(specifier, importer);
			assert.ok(id, `The catalog dependency ${specifier} must belong to ${importer}.`);
			let pending = urls.get(id);
			if (!pending) {
				pending = (async () => {
					const dependency = await plugin.load.call({ addWatchFile() {} }, id);
					assert.ok(dependency, `The catalog dependency ${id} must remain registered.`);
					await onDependency?.({ specifier, id, source: dependency });
					return `data:text/javascript,${encodeURIComponent(await materialize(dependency, id))}`;
				})();
				urls.set(id, pending);
			}
			edits.push({ ...reference, replacement: JSON.stringify(await pending) });
		}
		for (const edit of edits.sort((left, right) => right.start - left.start)) {
			text = text.slice(0, edit.start) + edit.replacement + text.slice(edit.end);
		}
		return text;
	}
	return await import(`data:text/javascript,${encodeURIComponent(await materialize(source, owner))}`) as Record<string, unknown>;
}
