/* SPDX-License-Identifier: AGPL-3.0-only */

import { dirname, resolve } from 'node:path';
import {
	createSourceFile, forEachChild, isArrayLiteralExpression, isCallExpression,
	isIdentifier, isImportDeclaration, isMetaProperty, isNamedImports,
	isNewExpression, isObjectLiteralExpression, isPropertyAccessExpression,
	isPropertyAssignment, isStringLiteral, ScriptKind, ScriptTarget, SyntaxKind,
	type Expression, type Node,
} from 'typescript';

const DECODER = '../../src/common/editor/controller/assistance/internal/video/local-assistance-video-keying-native-decoder.ts';

/** Read the maintained browser fixture's actual bundle input without executing its script. */
export function nightlyKeyingGeneratedEntry(source: string, specPath: string): string {
	const parsed = createSourceFile(specPath, source, ScriptTarget.Latest, true, ScriptKind.JS);
	for (const [module, binding] of [['esbuild', 'build'], ['node:url', 'fileURLToPath']]) {
		if (!parsed.statements.some(statement => isImportDeclaration(statement)
			&& isStringLiteral(statement.moduleSpecifier) && statement.moduleSpecifier.text === module
			&& statement.importClause?.isTypeOnly === false
			&& statement.importClause.namedBindings && isNamedImports(statement.importClause.namedBindings)
			&& statement.importClause.namedBindings.elements.some(element => !element.isTypeOnly
				&& !element.propertyName && element.name.text === binding))) {
			throw new TypeError(`The generated keying fixture requires its maintained ${binding} import.`);
		}
	}
	const entries: string[] = [];
	function visit(node: Node): void {
		if (isCallExpression(node) && isIdentifier(node.expression) && node.expression.text === 'build') {
			const options = node.arguments[0];
			if (node.arguments.length !== 1 || !options || !isObjectLiteralExpression(options)) {
				throw new TypeError('The generated keying fixture requires literal build options.');
			}
			const declarations = options.properties.filter(property => isPropertyAssignment(property)
				&& (isIdentifier(property.name) || isStringLiteral(property.name)) && property.name.text === 'entryPoints');
			const declaration = declarations[0];
			if (declarations.length !== 1 || !declaration || !isPropertyAssignment(declaration)
				|| !isArrayLiteralExpression(declaration.initializer) || declaration.initializer.elements.length !== 1) {
				throw new TypeError('The generated keying fixture requires exactly one literal entry point.');
			}
			entries.push(readEntry(declaration.initializer.elements[0]!, specPath));
		}
		forEachChild(node, visit);
	}
	visit(parsed);
	if (entries.length !== 1) throw new TypeError('The generated keying fixture requires exactly one maintained build.');
	return entries[0]!;
}

function readEntry(value: Expression, specPath: string): string {
	if (!isCallExpression(value) || !isIdentifier(value.expression) || value.expression.text !== 'fileURLToPath'
		|| value.arguments.length !== 1) throw new TypeError('The generated keying entry requires fileURLToPath.');
	const url = value.arguments[0];
	if (!url || !isNewExpression(url) || !isIdentifier(url.expression) || url.expression.text !== 'URL'
		|| url.arguments?.length !== 2) throw new TypeError('The generated keying entry requires its literal source URL.');
	const [path, base] = url.arguments;
	if (!path || !isStringLiteral(path) || path.text !== DECODER) {
		throw new TypeError('The generated keying fixture must retain its exact native decoder source.');
	}
	if (!base || !isPropertyAccessExpression(base) || base.name.text !== 'url'
		|| !isMetaProperty(base.expression) || base.expression.keywordToken !== SyntaxKind.ImportKeyword
		|| base.expression.name.text !== 'meta') throw new TypeError('The generated keying entry requires import.meta.url.');
	return resolve(dirname(specPath), path.text);
}
