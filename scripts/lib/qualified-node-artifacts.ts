/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { basename, extname, isAbsolute, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { transformSync, version as esbuildVersion, type Loader, type TransformOptions } from 'esbuild';

import { digestCoverageTestLayers, validateCoverageTestLayerFiles } from './e2e-coverage-layer-policy.mjs';
import { revisionBoundSource } from './e2e-coverage-integrity.mjs';

export const QUALIFIED_NODE_MANIFEST_ENV = 'SCAPE_QUALIFIED_NODE_MANIFEST';
export const QUALIFIED_NODE_OUTPUT_ENV = 'SCAPE_QUALIFIED_NODE_OUTPUT';
export const QUALIFIED_NODE_TESTS_ENV = 'SCAPE_QUALIFIED_NODE_TESTS';

export interface QualifiedNodeSourcePolicy {
	readonly path: string;
	readonly sourceSha256: string;
	readonly nodeTests: readonly string[];
}

export interface QualifiedNodeTestSource {
	readonly path: string;
	readonly sha256: string;
	readonly byteLength: number;
}

export interface QualifiedNodeModule {
	readonly sourcePath: string;
	readonly sourceSha256: string;
	readonly sourceBytes: number;
	readonly sourceUrl: string;
	readonly sourceFile: string;
	readonly codeFile: string;
	readonly generatedSha256: string;
	readonly generatedBytes: number;
	readonly generatedUtf16Length: number;
	readonly mapFile: string;
	readonly sourceMapSha256: string;
	readonly sourceMapBytes: number;
	readonly inlineSourceMap: Readonly<{ startOffset: number; endOffset: number; trailerSha256: string }>;
	readonly nodeTests: readonly string[];
}

export interface QualifiedNodeManifest {
	readonly kind: 'soundscaper-qualified-node-artifacts';
	readonly schemaVersion: 1;
	readonly sourceRevision: string;
	readonly nodeVersion: string;
	readonly policyDigest: string;
	readonly packageLockSha256: string;
	readonly compiler: Readonly<{ name: 'esbuild'; version: string; options: typeof QUALIFIED_NODE_COMPILER_OPTIONS }>;
	readonly selectedTests: readonly QualifiedNodeTestSource[];
	readonly modules: readonly QualifiedNodeModule[];
}

export interface QualifiedNodeRange {
	readonly startOffset: number;
	readonly endOffset: number;
	readonly count: number;
}

export interface QualifiedNodeScriptCoverage {
	readonly scriptId: string;
	readonly url: string;
	readonly functions: readonly Readonly<{
		functionName: string;
		isBlockCoverage: boolean;
		ranges: readonly QualifiedNodeRange[];
	}>[];
}

export interface QualifiedNodeObservation {
	readonly scriptId: string;
	readonly url: string;
	readonly sourcePath: string;
	readonly actualSha256: string;
	readonly sourceMapURL: string;
}

export interface QualifiedNodeProfile {
	readonly result: readonly QualifiedNodeScriptCoverage[];
	readonly 'script-source-cache': Readonly<Record<string, string>>;
	readonly 'source-map-cache': Readonly<Record<string, unknown>>;
	readonly qualifiedNode: Readonly<{
		kind: 'soundscaper-qualified-node-profile';
		schemaVersion: 1;
		manifestSha256: string;
		sourceRevision: string;
		policyDigest: string;
		pid: number;
		threadId: number;
		isMainThread: boolean;
		nodeTestPath: string;
		argv: readonly string[];
		execArgv: readonly string[];
		rawFiles: readonly Readonly<{ path: string; sha256: string; byteLength: number }>[];
		observations: readonly QualifiedNodeObservation[];
		status: 'passed' | 'failed';
		exitCode: number;
	}>;
}

export const QUALIFIED_NODE_COMPILER_OPTIONS = Object.freeze({
	format: 'esm', target: 'esnext', sourcemap: 'inline', sourcesContent: true,
	charset: 'utf8', legalComments: 'inline', minify: false, treeShaking: false, keepNames: false,
} as const);

export function qualifiedNodeHash(value: string | Uint8Array): string {
	return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

/** The source basename preserves relative map ownership at the original runtime URL. */
export function compileQualifiedNodeSource(source: string, sourcePath: string): string {
	const loaders: Readonly<Record<string, Loader>> = {
		'.js': 'js', '.mjs': 'js', '.cjs': 'js', '.jsx': 'jsx',
		'.ts': 'ts', '.mts': 'ts', '.cts': 'ts', '.tsx': 'tsx',
	};
	const loader = loaders[extname(sourcePath)]; assert.ok(loader, 'qualified source needs a supported exact extension');
	const options: TransformOptions = { ...QUALIFIED_NODE_COMPILER_OPTIONS, loader, sourcefile: basename(sourcePath) };
	const transformed = transformSync(source, options);
	assert.equal(transformed.warnings.length, 0, 'qualified compilation must be warning-free');
	return transformed.code;
}

export function prepareQualifiedNodeArtifacts(options: {
	repositoryRoot: string;
	policy: unknown;
	selectedTestFiles: readonly string[];
	outputRoot: string;
	expectedRevision: string;
}): { manifestPath: string; captureDirectory: string; manifest: QualifiedNodeManifest } | null {
	const repositoryRoot = realpathSync(options.repositoryRoot);
	const policy = validateCoverageTestLayerFiles(options.policy, { repositoryRoot }) as { sources: readonly QualifiedNodeSourcePolicy[] };
	const boundTests = new Set(policy.sources.flatMap(source => [...source.nodeTests]));
	const selected = [...new Set(options.selectedTestFiles.map(path => {
		const candidate = relative(repositoryRoot, resolve(repositoryRoot, path)).replaceAll('\\', '/');
		assert.ok(candidate !== '' && !isAbsolute(candidate) && !candidate.startsWith('../'), 'selected test stays in repository');
		return candidate;
	}))].filter(path => boundTests.has(path)).sort();
	if (!selected.length) return null;
	assert.match(options.expectedRevision, /^[a-f0-9]{40}$/u);
	const outputRoot = resolve(options.outputRoot); mkdirSync(join(outputRoot, 'artifacts'), { recursive: true });
	const selectedTests = selected.map(path => {
		const source = revisionBoundSource(repositoryRoot, options.expectedRevision, path);
		return { path, sha256: source.sha256 as string, byteLength: source.bytes.byteLength as number };
	});
	const modules = policy.sources.map(entry => {
		const source = revisionBoundSource(repositoryRoot, options.expectedRevision, entry.path);
		assert.equal(source.sha256, entry.sourceSha256, 'reviewed source bytes must equal the declared Git revision');
		const generated = compileQualifiedNodeSource(source.text, entry.path);
		assert.equal(generated.split('sourceMappingURL=').length, 2, 'exactly one terminal map directive');
		const inlineMapStart = generated.indexOf('//# sourceMappingURL=');
		const encoded = /\/\/# sourceMappingURL=data:application\/json;base64,([^\n]+)\n?$/u.exec(generated)?.[1]; assert.ok(encoded);
		const mapBytes = Buffer.from(encoded, 'base64');
		const map = JSON.parse(mapBytes.toString('utf8')) as { sources: unknown; sourcesContent: unknown };
		assert.deepEqual(map.sources, [basename(entry.path)]); assert.deepEqual(map.sourcesContent, [source.text]);
		const id = qualifiedNodeHash(entry.path).slice('sha256:'.length);
		const sourceFile = `artifacts/${id}.source`, codeFile = `artifacts/${id}.js`, mapFile = `artifacts/${id}.map.json`;
		writeFileSync(join(outputRoot, sourceFile), source.bytes);
		writeFileSync(join(outputRoot, codeFile), generated); writeFileSync(join(outputRoot, mapFile), mapBytes);
		return { sourcePath: entry.path, sourceSha256: source.sha256 as string, sourceBytes: source.bytes.byteLength as number,
			sourceUrl: pathToFileURL(join(repositoryRoot, entry.path)).href, sourceFile, codeFile,
			generatedSha256: qualifiedNodeHash(generated), generatedBytes: Buffer.byteLength(generated), generatedUtf16Length: generated.length,
			mapFile, sourceMapSha256: qualifiedNodeHash(mapBytes), sourceMapBytes: mapBytes.byteLength,
			inlineSourceMap: { startOffset: inlineMapStart, endOffset: generated.length, trailerSha256: qualifiedNodeHash(generated.slice(inlineMapStart)) },
			nodeTests: [...entry.nodeTests] };
	});
	const manifest: QualifiedNodeManifest = {
		kind: 'soundscaper-qualified-node-artifacts', schemaVersion: 1, sourceRevision: options.expectedRevision,
		nodeVersion: process.versions.node, policyDigest: digestCoverageTestLayers(options.policy) as string,
		packageLockSha256: qualifiedNodeHash(readFileSync(join(repositoryRoot, 'package-lock.json'))),
		compiler: { name: 'esbuild', version: esbuildVersion, options: QUALIFIED_NODE_COMPILER_OPTIONS }, selectedTests, modules,
	};
	const manifestPath = join(outputRoot, 'manifest.json'); writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
	return { manifestPath, captureDirectory: outputRoot, manifest };
}
