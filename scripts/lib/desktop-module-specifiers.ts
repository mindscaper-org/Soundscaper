/* SPDX-License-Identifier: AGPL-3.0-only */
import ts from 'typescript';

/** Inspect executable module references, including literal require and dynamic import. */
export function desktopModuleSpecifiers(source: string): readonly string[] {
	const specifiers: string[] = [];
	const file = ts.createSourceFile('desktop-source.js', source, ts.ScriptTarget.Latest, false, ts.ScriptKind.JS);
	function visit(node: ts.Node): void {
		if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node))
			&& node.moduleSpecifier && ts.isStringLiteralLike(node.moduleSpecifier)) specifiers.push(node.moduleSpecifier.text);
		if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword
			|| (ts.isIdentifier(node.expression) && node.expression.text === 'require'))) {
			const argument = node.arguments[0];
			if (argument && ts.isStringLiteralLike(argument)) specifiers.push(argument.text);
		}
		ts.forEachChild(node, visit);
	}
	visit(file);
	return specifiers;
}
