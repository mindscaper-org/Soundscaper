/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { version as esbuildVersion } from 'esbuild';
import ts from 'typescript';

import { digestCoverageTestLayers, resolveCoverageTestLayers } from './e2e-coverage-layer-policy.mjs';
import { revisionBoundSource, sha256Digest } from './e2e-coverage-integrity.mjs';
import { qualifiedEvidencePath } from './e2e-coverage-node-transport.mjs';
import { compileQualifiedNodeSource, QUALIFIED_NODE_COMPILER_OPTIONS } from './qualified-node-artifacts.ts';

export function rejectCoverageIgnoreDirectives(source, label) {
	const scanner = ts.createScanner(ts.ScriptTarget.Latest, false, ts.LanguageVariant.Standard, source);
	for (let token = scanner.scan(); token !== ts.SyntaxKind.EndOfFileToken; token = scanner.scan()) {
		if ((token === ts.SyntaxKind.SingleLineCommentTrivia || token === ts.SyntaxKind.MultiLineCommentTrivia)
			&& /\b(?:c8|v8|istanbul)\s+ignore\b/iu.test(scanner.getTokenText())) {
			throw new Error(`${label} contains a coverage ignore directive; qualified denominators cannot exclude executable code.`);
		}
	}
}

/** These V8 branch producers do not yet have an independent anti-omission proof. */
export function rejectUnsupportedNodeControlFlow(source, label) {
	const file = ts.createSourceFile(label, source, ts.ScriptTarget.Latest, true);
	assert.equal(file.parseDiagnostics.length, 0, `${label} has invalid source syntax`);
	visit(file);
	function visit(node) {
		const loopOrSwitch = ts.isForStatement(node) || ts.isForInStatement(node) || ts.isForOfStatement(node)
			|| ts.isWhileStatement(node) || ts.isDoStatement(node) || ts.isSwitchStatement(node);
		const defaultInitializer = (ts.isParameter(node) || ts.isBindingElement(node)) && node.initializer;
		const logicalAssignment = ts.isBinaryExpression(node) && [ts.SyntaxKind.AmpersandAmpersandEqualsToken,
			ts.SyntaxKind.BarBarEqualsToken, ts.SyntaxKind.QuestionQuestionEqualsToken].includes(node.operatorToken.kind);
		if (loopOrSwitch || defaultInitializer || logicalAssignment) {
			throw new Error(`${label} has unsupported independent Node branch topology (${ts.SyntaxKind[node.kind]} at ${node.getStart(file)}). `
				+ 'Keep this source native-owned until its branch topology has a sound independent validator.');
		}
		ts.forEachChild(node, visit);
	}
}

/** An analysis-only copy; all executable bytes and UTF16 offsets stay identical. */
export function neutralizeQualifiedNodeMap(code, module) {
	const { startOffset, endOffset, trailerSha256 } = module.inlineSourceMap;
	assert.equal(code.split('sourceMappingURL=').length, 2, 'exactly one terminal source map directive required');
	assert.ok(Number.isSafeInteger(startOffset) && startOffset >= 0 && endOffset === code.length
		&& code.indexOf('//# sourceMappingURL=') === startOffset, 'terminal map offsets differ');
	const trailer = code.slice(startOffset);
	assert.match(trailer, /^\/\/# sourceMappingURL=data:application\/json;base64,[A-Za-z0-9+/=]+\n?$/u, 'terminal inline map required');
	assert.equal(sha256Digest(trailer), trailerSha256, 'terminal map digest differs');
	return code.slice(0, startOffset) + trailer.replace(/[^\r\n]/gu, ' ');
}

function fields(value, expected, label) {
	assert.ok(value && typeof value === 'object' && !Array.isArray(value), `${label} needs a record`);
	assert.deepEqual(Object.keys(value).sort(), [...expected].sort(), `${label} has missing or unknown fields`);
}

function exactFile(root, path, hash, byteLength) {
	const bytes = readFileSync(qualifiedEvidencePath(root, path));
	assert.equal(bytes.byteLength, byteLength, `${path} bytes differ`); assert.equal(sha256Digest(bytes), hash, `${path} digest differs`);
	return bytes;
}

export function readQualifiedNodeEvidence({ evidenceRoot, repositoryRoot, inventory, policy, expectedRevision }) {
	const resolution = resolveCoverageTestLayers({ policy, inventory });
	const manifestBytes = readFileSync(qualifiedEvidencePath(evidenceRoot, 'manifest.json'));
	const manifest = JSON.parse(manifestBytes.toString('utf8'));
	fields(manifest, ['kind', 'schemaVersion', 'sourceRevision', 'nodeVersion', 'policyDigest', 'packageLockSha256', 'compiler', 'selectedTests', 'modules'], 'Node manifest');
	assert.equal(manifest.kind, 'soundscaper-qualified-node-artifacts'); assert.equal(manifest.schemaVersion, 1);
	assert.equal(manifest.sourceRevision, expectedRevision, 'Node evidence revision differs');
	assert.equal(manifest.sourceRevision, inventory.sourceRevision, 'Node/native revision differs');
	assert.equal(manifest.nodeVersion, process.versions.node, 'Node runtime differs');
	assert.equal(manifest.policyDigest, digestCoverageTestLayers(policy), 'Node policy digest differs');
	assert.equal(manifest.packageLockSha256, revisionBoundSource(repositoryRoot, expectedRevision, 'package-lock.json').sha256, 'Node dependency lock differs');
	assert.deepEqual(manifest.compiler, { name: 'esbuild', version: esbuildVersion, options: QUALIFIED_NODE_COMPILER_OPTIONS }, 'Node compiler differs');
	assert.ok(Array.isArray(manifest.selectedTests) && manifest.selectedTests.length > 0, 'Node selected tests required');
	const allowedTests = new Set(resolution.nodeSources.flatMap(source => source.policyEntry.nodeTests));
	const selectedPaths = manifest.selectedTests.map(test => {
		fields(test, ['path', 'sha256', 'byteLength'], 'Node test'); assert.ok(allowedTests.has(test.path), 'unreviewed Node test');
		const actual = revisionBoundSource(repositoryRoot, expectedRevision, test.path);
		assert.equal(actual.sha256, test.sha256, 'Node test source digest differs'); assert.equal(actual.bytes.byteLength, test.byteLength, 'Node test source bytes differ');
		return test.path;
	});
	assert.deepEqual(selectedPaths, [...new Set(selectedPaths)].sort(), 'Node selected tests need unique sorted paths');
	assert.ok(Array.isArray(manifest.modules), 'Node modules required');
	assert.deepEqual(manifest.modules.map(module => module.sourcePath), resolution.nodeSources.map(source => source.path), 'Node full source inventory differs');
	const modules = manifest.modules.map(module => {
		fields(module, ['sourcePath', 'sourceSha256', 'sourceBytes', 'sourceUrl', 'sourceFile', 'codeFile', 'generatedSha256', 'generatedBytes', 'generatedUtf16Length', 'mapFile', 'sourceMapSha256', 'sourceMapBytes', 'inlineSourceMap', 'nodeTests'], 'Node module');
		const reviewed = resolution.nodeSources.find(source => source.path === module.sourcePath);
		assert.equal(module.sourceSha256, reviewed.sha256, 'Node/native source digest differs');
		assert.deepEqual(module.nodeTests, reviewed.policyEntry.nodeTests, 'Node module test bindings differ');
		const actual = revisionBoundSource(repositoryRoot, expectedRevision, module.sourcePath);
		const source = exactFile(evidenceRoot, module.sourceFile, module.sourceSha256, module.sourceBytes).toString('utf8');
		assert.equal(source, actual.text, 'Node source preimage differs');
		const code = exactFile(evidenceRoot, module.codeFile, module.generatedSha256, module.generatedBytes).toString('utf8');
		assert.equal(code.length, module.generatedUtf16Length, 'Node UTF16 length differs');
		assert.equal(code, compileQualifiedNodeSource(source, module.sourcePath), 'independent Node compilation differs');
		rejectCoverageIgnoreDirectives(source, module.sourcePath); rejectCoverageIgnoreDirectives(code, module.sourcePath);
		rejectUnsupportedNodeControlFlow(source, module.sourcePath); rejectUnsupportedNodeControlFlow(code, module.sourcePath);
		const mapBytes = exactFile(evidenceRoot, module.mapFile, module.sourceMapSha256, module.sourceMapBytes);
		const map = JSON.parse(mapBytes.toString('utf8'));
		assert.deepEqual(map.sources, [basename(module.sourcePath)]); assert.deepEqual(map.sourcesContent, [source]);
		const sourceUrl = new URL(module.sourceUrl);
		assert.ok(sourceUrl.protocol === 'file:' && !sourceUrl.search && !sourceUrl.hash
			&& fileURLToPath(sourceUrl).replaceAll('\\', '/').endsWith(`/${module.sourcePath}`), 'Node original source URL differs');
		fields(module.inlineSourceMap, ['startOffset', 'endOffset', 'trailerSha256'], 'Node inline map');
		const analysisSource = neutralizeQualifiedNodeMap(code, module);
		assert.deepEqual(Buffer.from(code.slice(module.inlineSourceMap.startOffset).split('base64,')[1].trim(), 'base64'), mapBytes, 'inline/standalone map bytes differ');
		return { module, source, code, map, analysisSource };
	});
	const profiles = readdirSync(qualifiedEvidencePath(evidenceRoot, 'captures')).sort().map(name => {
		assert.match(name, /^[0-9]+-0\.json$/u, 'qualified receipt must identify its main isolate');
		const profile = JSON.parse(readFileSync(qualifiedEvidencePath(evidenceRoot, `captures/${name}`), 'utf8'));
		validateProfile({ profile, manifest, manifestBytes, modules, evidenceRoot, name }); return profile;
	});
	assert.ok(profiles.length > 0, 'Node evidence has no qualified capture receipts');
	return { manifest, modules, profiles };
}

function validateProfile({ profile, manifest, manifestBytes, modules, evidenceRoot, name }) {
	fields(profile, ['result', 'script-source-cache', 'source-map-cache', 'qualifiedNode'], 'Node profile');
	const header = profile.qualifiedNode;
	fields(header, ['kind', 'schemaVersion', 'manifestSha256', 'sourceRevision', 'policyDigest', 'pid', 'threadId', 'isMainThread', 'nodeTestPath', 'argv', 'execArgv', 'rawFiles', 'observations', 'status', 'exitCode'], 'Node profile header');
	assert.equal(header.kind, 'soundscaper-qualified-node-profile'); assert.equal(header.schemaVersion, 1);
	assert.equal(header.manifestSha256, sha256Digest(manifestBytes), 'Node receipt manifest differs');
	assert.equal(header.sourceRevision, manifest.sourceRevision); assert.equal(header.policyDigest, manifest.policyDigest);
	assert.ok(Number.isSafeInteger(header.pid) && header.pid > 0 && header.threadId === 0 && header.isMainThread === true, 'Node receipt isolate differs');
	assert.equal(name, `${header.pid}-0.json`, 'Node receipt filename differs');
	assert.equal(header.status, 'passed', 'Node test process did not pass'); assert.equal(header.exitCode, 0, 'Node test process failed');
	assert.ok(manifest.selectedTests.some(test => test.path === header.nodeTestPath), 'Node receipt test is unselected');
	assert.ok(Array.isArray(header.argv) && typeof header.argv[1] === 'string'
		&& header.argv[1].replaceAll('\\', '/').endsWith(`/${header.nodeTestPath}`), 'Node actual test argv differs');
	assert.ok(Array.isArray(header.execArgv) && header.execArgv.every(value => typeof value === 'string'), 'Node execArgv differs');
	assert.ok(Array.isArray(header.rawFiles) && header.rawFiles.length > 0, 'Node receipt raw files missing');
	assert.equal(new Set(header.rawFiles.map(file => file.path)).size, header.rawFiles.length, 'duplicate Node raw file');
	const rawEntries = [], rawMaps = new Map();
	for (const file of header.rawFiles) {
		fields(file, ['path', 'sha256', 'byteLength'], 'Node raw file');
		assert.match(file.path, new RegExp(`^raw/coverage-${header.pid}-[0-9]+-0\\.json$`, 'u'), 'Node raw profile isolate differs');
		const raw = JSON.parse(exactFile(evidenceRoot, file.path, file.sha256, file.byteLength).toString('utf8'));
		assert.ok(Array.isArray(raw.result), 'Node raw entries missing'); rawEntries.push(...raw.result);
		for (const [url, cache] of Object.entries(raw['source-map-cache'] ?? {})) rawMaps.set(url, cache);
	}
	assert.ok(Array.isArray(header.observations) && Array.isArray(profile.result), 'Node observations/results missing');
	assert.equal(new Set(header.observations.map(observation => observation.scriptId)).size, header.observations.length, 'duplicate Inspector scriptId');
	const eligible = modules.filter(({ module }) => module.nodeTests.includes(header.nodeTestPath));
	const expected = rawEntries.filter(entry => eligible.some(({ module }) => entry.url === module.sourceUrl));
	assert.deepEqual(profile.result, expected, 'Node filtered coverage differs from actual raw entries');
	assert.equal(new Set(profile.result.map(entry => entry.scriptId)).size, profile.result.length, 'duplicate Node runtime scriptId');
	for (const entry of profile.result) {
		const prepared = eligible.find(({ module }) => module.sourceUrl === entry.url);
		const observation = header.observations.find(value => value.scriptId === entry.scriptId);
		assert.ok(observation, 'Node entry lacks actual Inspector observation');
		fields(observation, ['scriptId', 'url', 'sourcePath', 'actualSha256', 'sourceMapURL'], 'Inspector observation');
		assert.equal(observation.url, entry.url); assert.equal(observation.sourcePath, prepared.module.sourcePath);
		assert.equal(observation.actualSha256, prepared.module.generatedSha256, 'actual Inspector implementation digest differs');
		assert.equal(observation.sourceMapURL, prepared.code.slice(prepared.module.inlineSourceMap.startOffset).split('sourceMappingURL=')[1].trim(), 'Inspector source map differs');
		assert.equal(profile['script-source-cache'][entry.url], prepared.code, 'actual Inspector source bytes differ');
		const cache = profile['source-map-cache'][entry.url]; assert.deepEqual(cache, rawMaps.get(entry.url), 'Node cached map differs from actual raw');
		const expectedMap = { ...prepared.map, sources: [entry.url], sourceRoot: '' };
		assert.deepEqual(cache?.data, expectedMap, 'Node actual source map differs');
		assert.ok(Array.isArray(entry.functions) && entry.functions.length > 0, 'Node function denominator missing');
	}
	assert.deepEqual(Object.keys(profile['script-source-cache']).sort(), [...new Set(profile.result.map(entry => entry.url))].sort(), 'Node source cache has unknown entries');
	assert.deepEqual(Object.keys(profile['source-map-cache']).sort(), Object.keys(profile['script-source-cache']).sort(), 'Node map cache has unknown entries');
}
