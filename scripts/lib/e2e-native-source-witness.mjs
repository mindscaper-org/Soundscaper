/* SPDX-License-Identifier: AGPL-3.0-only */

import { readFileSync, realpathSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import ts from 'typescript';

import { diagnosticErrorMessage as errorMessage } from './diagnostic-error-message.ts';
import { sha256Digest } from './e2e-coverage-integrity.mjs';
import { E2E_REPOSITORY_URL_PREFIX } from './e2e-coverage-prefixes.mjs';
import { deriveTopology, sourceOwnership, coverageCounter } from './e2e-v8-source-topology.mjs';
import { deriveV8FunctionTopology } from './e2e-v8-function-topology.mjs';

/** A reviewed test selector is not runtime proof: require actual execution in each declared realm. */
export function validateNativeSourceWitnesses({ repositoryRoot, artifactRoot, profiles, scripts, nodeSources }) {
	const failures = [], witnesses = [];
	for (const source of nodeSources) {
		let original, originalGeometry;
		try {
			original = readFileSync(inside(repositoryRoot, source.path), 'utf8');
			if (sha256Digest(original) !== source.sha256) throw new Error('original source bytes do not match the inventory source SHA-256');
			originalGeometry = runtimeGeometry(original, source.path);
		} catch (error) {
			failures.push(`${source.path} native witness source could not be read: ${errorMessage(error)}`);
			continue;
		}
		for (const surface of source.policyEntry.nativeWitness.surfaces) {
			let witness;
			const candidates = scripts.filter(script => script.surface === surface && script.sources.includes(source.path));
			for (const script of candidates) {
				try {
					witness = scriptWitness({ artifactRoot, profiles: profiles.filter(item => item.surface === surface), script, source, original, originalGeometry });
					if (witness) break;
				} catch (error) {
					failures.push(`${surface} ${source.path} native witness: ${errorMessage(error)}`);
				}
			}
			if (witness) witnesses.push({ source: source.path, surface, ...witness });
			else failures.push(`${surface} ${source.path} needs a positive mapped ${originalGeometry.hasFunctions ? 'non-root function' : 'executable statement'} native witness.`);
		}
	}
	return { failures, witnesses };
}

function scriptWitness({ artifactRoot, profiles, script, source, original, originalGeometry }) {
	if (script.sourceMapSha256 == null) throw new Error('a source-mapped witness requires an authenticated source map');
	const entries = profiles.flatMap(({ profile }) => (profile.result ?? []).filter(entry => entry.url === script.coverageUrl));
	if (!entries.length) return null;
	const caches = profiles.flatMap(({ profile }) => {
		const cache = profile['source-map-cache']?.[script.coverageUrl]; return cache ? [cache] : [];
	});
	const generated = readFileSync(inside(artifactRoot, script.artifactPath), 'utf8');
	if (sha256Digest(generated) !== script.sha256) throw new Error('native executable bytes changed');
	const ownership = sourceOwnership({ caches, script, source: generated });
	if (ownership.failures.length) throw new Error(ownership.failures.join('; '));
	const topology = deriveTopology(generated, script.artifactPath, ownership);
	if (topology.failures.length) throw new Error(topology.failures.join('; '));
	const map = caches[0].data;
	const index = map.sources.findIndex(url => repositoryPath(url) === source.path);
	if (index < 0) throw new Error('native map does not name the exact source');
	if (map.sourcesContent?.[index] != null && map.sourcesContent[index] !== original) throw new Error('mapped original source bytes differ from the source SHA-256');
	const intervals = originalIntervals(map, generated, original, index);
	const observations = entries.flatMap(entry => entry.functions ?? []);
	if (originalGeometry.hasFunctions) {
		for (const owner of topology.owners.filter(candidate => candidate.kind !== 'root')) {
			// A same-span script root is never sufficient, even when an anonymous function aliases its geometry.
			if (owner.start === 0 && owner.end === generated.length) continue;
			const nested = topology.functionTopology.functions.filter(candidate => candidate.kind !== 'root'
				&& owner.start <= candidate.start && candidate.end <= owner.end
				&& (owner.start !== candidate.start || owner.end !== candidate.end));
			const ownerObservations = observations.filter(fn => matches(fn, owner) && fn.isBlockCoverage === true);
			if (!ownerObservations.some(fn => fn.ranges[0].count > 0)) continue;
			const executes = executedCodeProbe(generated, ownerObservations);
			const mappedOwnFunction = intervals.some(interval => originalGeometry.functions.some(fn => containsOwn(fn, interval.original, originalGeometry.functions))
				&& ownsUnexcluded(interval, owner, nested, executes));
			if (mappedOwnFunction) {
				return { script: script.id, kind: 'function', span: { start: owner.start, end: owner.end } };
			}
		}
		return null;
	}
	// Only original sources with no runtime functions may use a mapped statement. Its innermost
	// generated function must execute; summing a positive script root over an uncalled wrapper is unsound.
	for (const interval of intervals) {
		if (!originalGeometry.statements.some(statement => statement.start <= interval.original && interval.original < statement.end)) continue;
		if (!/\S/u.test(generated.slice(interval.start, interval.end))) continue;
		const owners = topology.functionTopology.functions.filter(owner => owner.start <= interval.start && interval.start < owner.end)
			.sort((left, right) => (left.end - left.start) - (right.end - right.start));
		const owner = owners[0]; if (!owner) continue;
		if (owners.some(candidate => candidate.kind !== 'root' && candidate.start === owner.start && candidate.end === owner.end) && owner.kind === 'root') continue;
		const observed = observations.filter(fn => matches(fn, owner));
		if (observed.length && coverageCounter(observed)(interval.start) > 0) {
			return { script: script.id, kind: 'statement', span: { start: interval.start, end: interval.end } };
		}
	}
	return null;
}

function runtimeGeometry(source, fileName) {
	const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true);
	if (file.parseDiagnostics.length) throw new Error('original source geometry is invalid');
	const explicit = [], statements = [], initializers = [];
	let hasClass = false;
	visit(file);
	const implicit = deriveV8FunctionTopology(file, source.length).functions.filter(fn => fn.kind === 'implicit')
		.map(fn => ({ ...fn, bodies: initializers.filter(initializer => fn.start <= initializer.start && initializer.end <= fn.end).flatMap(initializer => initializer.bodies) }))
		.filter(fn => fn.bodies.length > 0);
	return { hasFunctions: hasClass || explicit.length > 0 || implicit.length > 0, functions: [...explicit, ...implicit], statements };

	function visit(node) {
		if (ts.isTypeNode(node) || ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node)
			|| node.modifiers?.some(modifier => modifier.kind === ts.SyntaxKind.DeclareKeyword)) return;
		if ((ts.isFunctionLike(node) || ts.isClassStaticBlockDeclaration(node)) && node.body) {
			explicit.push({ start: node.getStart(file), end: node.end, bodies: bodySpans(node.body) });
		}
		if (ts.isPropertyDeclaration(node)) {
			const value = node.initializer ?? node.name;
			initializers.push({ start: node.getStart(file), end: value.end, bodies: [{ start: value.getStart(file), end: value.end }] });
		}
		if (ts.isClassStaticBlockDeclaration(node)) initializers.push({ start: node.getStart(file), end: node.end, bodies: bodySpans(node.body) });
		if (ts.isClassDeclaration(node) || ts.isClassExpression(node)) hasClass = true;
		if (node.parent === file && ((ts.isVariableStatement(node) && node.declarationList.declarations.some(declaration => declaration.initializer))
			|| (ts.isExpressionStatement(node) && !ts.isStringLiteral(node.expression)) || ts.isExportAssignment(node)
			|| ts.isIfStatement(node) || ts.isIterationStatement(node, false) || ts.isTryStatement(node) || ts.isSwitchStatement(node))) {
			statements.push({ start: node.getStart(file), end: node.end });
		}
		ts.forEachChild(node, visit);
	}

	function bodySpans(body) {
		return ts.isBlock(body) ? body.statements.map(statement => ({ start: statement.getStart(file), end: statement.end }))
			: [{ start: body.getStart(file), end: body.end }];
	}
}

function containsOwn(span, offset, spans) {
	return span.bodies.some(body => body.start <= offset && offset < body.end) && !spans.some(child => child !== span
		&& span.start <= child.start && child.end <= span.end && (child.start !== span.start || child.end !== span.end)
		&& child.start <= offset && offset < child.end);
}

function ownsUnexcluded(interval, owner, exclusions, executes) {
	let start = Math.max(interval.start, owner.start); const end = Math.min(interval.end, owner.end);
	for (const excluded of [...exclusions].sort((left, right) => left.start - right.start)) {
		if (excluded.end <= start) continue;
		if (excluded.start >= end) break;
		if (excluded.start > start && executes(start, Math.min(excluded.start, end))) return true;
		start = Math.max(start, excluded.end);
	}
	return start < end && executes(start, end);
}

function executedCodeProbe(source, observations) {
	const countAt = coverageCounter(observations);
	const boundaries = [...new Set(observations.flatMap(fn => fn.ranges.flatMap(range => [range.startOffset, range.endOffset])))].sort((left, right) => left - right);
	return (start, end) => {
		const probes = [start, ...boundaries.filter(offset => start < offset && offset < end), end];
		for (let index = 0; index + 1 < probes.length; index += 1) {
			const code = /\S/u.exec(source.slice(probes[index], probes[index + 1]));
			if (code && countAt(probes[index] + code.index) > 0) return true;
		}
		return false;
	};
}

function originalIntervals(map, generated, original, sourceIndex) {
	const generatedLines = lineStarts(generated), originalLines = lineStarts(original), result = [];
	let previousSource = 0, originalLine = 0, originalColumn = 0;
	for (const [line, encodedLine] of map.mappings.split(';').entries()) {
		let column = 0; const segments = [];
		for (const encoded of encodedLine.split(',')) {
			if (!encoded) continue;
			const fields = vlqFields(encoded); column += fields[0];
			if (fields.length === 1) { segments.push({ column, original: null }); continue; }
			previousSource += fields[1]; originalLine += fields[2]; originalColumn += fields[3];
			if (originalLine < 0 || originalColumn < 0) throw new Error('source map original coordinates are invalid');
			let originalOffset = null;
			if (previousSource === sourceIndex) {
				const start = originalLines[originalLine], end = originalLines[originalLine + 1] ?? original.length;
				if (start === undefined || start + originalColumn > end) throw new Error('source map original coordinates escape the source');
				originalOffset = start + originalColumn;
			}
			segments.push({ column, original: originalOffset });
		}
		for (const [index, segment] of segments.entries()) {
			if (segment.original === null) continue;
			const start = generatedLines[line] + segment.column;
			const end = index + 1 < segments.length ? generatedLines[line] + segments[index + 1].column : (generatedLines[line + 1] ?? generated.length);
			if (start < end) result.push({ start, end, original: segment.original });
		}
	}
	return result;
}

function vlqFields(encoded) {
	const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
	const fields = []; let value = 0, shift = 0;
	for (const character of encoded) {
		const digit = alphabet.indexOf(character); if (digit < 0) throw new Error('invalid source map VLQ');
		value += (digit & 31) * 2 ** shift;
		if (!Number.isSafeInteger(value)) throw new Error('unsafe source map VLQ');
		if (digit & 32) { shift += 5; continue; }
		fields.push(value % 2 ? -Math.floor(value / 2) : value / 2); value = 0; shift = 0;
	}
	if (shift || ![1, 4, 5].includes(fields.length)) throw new Error('invalid source map VLQ shape');
	return fields;
}

function lineStarts(source) {
	const starts = [0]; for (let index = 0; index < source.length; index += 1) if (source[index] === '\n') starts.push(index + 1);
	return starts;
}

function matches(fn, owner) {
	return fn.ranges?.[0]?.startOffset === owner.start && fn.ranges[0].endOffset === owner.end;
}

function repositoryPath(url) {
	return typeof url === 'string' && url.startsWith(E2E_REPOSITORY_URL_PREFIX)
		? decodeURIComponent(url.slice(E2E_REPOSITORY_URL_PREFIX.length)) : null;
}

function inside(root, path) {
	if (isAbsolute(path)) throw new Error('native witness path must be relative');
	const actualRoot = realpathSync(root), actual = realpathSync(resolve(actualRoot, path)), difference = relative(actualRoot, actual);
	if (isAbsolute(difference) || difference === '..' || difference.startsWith(`..${sep}`)) throw new Error('native witness path escapes its root');
	return actual;
}
