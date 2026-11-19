/* SPDX-License-Identifier: AGPL-3.0-only */

import { readFileSync } from 'node:fs';
import ts from 'typescript';

/**
 * c8 can map the same source function twice when Node loads its TypeScript
 * source and Chromium loads a minified chunk. The two mappings have the same
 * source span but different names and starting columns. Count that source
 * function once, with execution from either runtime.
 */
export function normalizeDuplicateFunctionCoverage(summary, detailed, sourceForPath = readSource) {
	const normalized = { ...summary };
	for (const [path, file] of Object.entries(detailed)) {
		if (!summary[path] || !file?.fnMap || !file?.f) continue;
		const exportGetters = commentMappedExportGetters(path, file, sourceForPath);
		const groups = new Map();
		for (const [id, functionInfo] of Object.entries(file.fnMap)) {
			if (exportGetters.has(id)) continue;
			const { start, end } = functionInfo.loc;
			const key = `${start.line}:${end.line}:${end.column}`;
			const group = groups.get(key) ?? [];
			group.push({ id, name: functionInfo.name, column: start.column });
			groups.set(key, group);
		}
		let removed = exportGetters.size;
		let removedCovered = [...exportGetters].filter(id => file.f[id] > 0).length;
		for (const group of groups.values()) {
			if (group.length !== 2) continue;
			const alias = group.find(({ name, column }) =>
				(column === 0 && /^[A-Za-z_$]$/u.test(name))
				|| (column === 1 && name === '<instance_members_initializer>'));
			const source = group.find(({ id }) => id !== alias?.id);
			if (!alias || !source || source.column !== (alias.column === 0 ? 7 : 10)
				|| (alias.name === '<instance_members_initializer>'
					? source.name !== alias.name : source.name.length <= 1)) continue;
			removed += 1;
			if (file.f[alias.id] > 0 && file.f[source.id] > 0) removedCovered += 1;
		}
		if (removed === 0) continue;
		const functions = summary[path].functions;
		const total = functions.total - removed;
		const covered = functions.covered - removedCovered;
		normalized[path] = {
			...summary[path],
			functions: {
				...functions,
				total,
				covered,
				pct: total === 0 ? 100 : Math.round(10000 * covered / total) / 100,
			},
		};
	}
	return normalized;
}

/**
 * tsx's CommonJS transform adds export getters that c8 maps onto the leading
 * license comment. Admit only an alias of an exported declaration whose real
 * body is also present in the report. Reading a getter never covers that body.
 */
function commentMappedExportGetters(path, file, sourceForPath) {
	const removed = new Set();
	const entries = Object.entries(file.fnMap);
	const candidates = entries.filter(([, { loc }]) => loc.start.column === 0
		&& loc.start.line === loc.end.line && loc.end.column > 0);
	if (candidates.length === 0) return removed;
	const source = sourceForPath(path);
	if (typeof source !== 'string') return removed;
	const comments = ts.getLeadingCommentRanges(source, 0) ?? [];
	if (comments.length === 0) return removed;
	const syntax = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
	const declarations = new Map(syntax.statements.filter(statement => ts.isFunctionDeclaration(statement)
		&& statement.name && statement.body
		&& statement.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword))
		.map(statement => [statement.name.text, statement]));
	const offset = position => {
		const starts = syntax.getLineStarts();
		const line = starts[position.line - 1];
		if (line === undefined || position.column < 0
			|| line + position.column > (starts[position.line] ?? source.length)) return null;
		return line + position.column;
	};
	for (const [id, info] of candidates) {
		const start = offset(info.loc.start), end = offset(info.loc.end);
		if (start === null || end === null || end <= start
			|| !comments.some(comment => start >= comment.pos && end <= comment.end)) continue;
		const declaration = declarations.get(info.name);
		if (!declaration) continue;
		const actualBody = entries.some(([otherId, other]) => {
			if (otherId === id || other.name !== info.name) return false;
			const otherStart = offset(other.loc.start), otherEnd = offset(other.loc.end);
			return otherStart !== null && otherStart >= declaration.getStart(syntax)
				&& otherStart <= declaration.body.getStart(syntax) && otherEnd === declaration.end;
		});
		if (actualBody) removed.add(id);
	}
	return removed;
}

function readSource(path) {
	try {
		return readFileSync(path, 'utf8');
	} catch (error) {
		if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return undefined;
		throw error;
	}
}
