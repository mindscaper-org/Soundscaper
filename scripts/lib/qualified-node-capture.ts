/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { Session } from 'node:inspector/promises';
import { registerHooks } from 'node:module';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { takeCoverage } from 'node:v8';
import { isMainThread, threadId } from 'node:worker_threads';

import {
	qualifiedNodeHash,
	type QualifiedNodeManifest,
	type QualifiedNodeModule,
	type QualifiedNodeObservation,
	type QualifiedNodeProfile,
	type QualifiedNodeScriptCoverage,
} from './qualified-node-artifacts.ts';

interface RawProfile {
	readonly result: readonly QualifiedNodeScriptCoverage[];
	readonly 'source-map-cache'?: Readonly<Record<string, unknown>>;
}

interface ObservedSource extends QualifiedNodeObservation {
	readonly source: string;
}

/** Installs no hooks or Inspector session outside the selected test's main isolate. */
export async function startQualifiedNodeCapture(options: {
	manifestPath: string;
	outputRoot: string;
	repositoryRoot: string;
}): Promise<{ active: boolean; finish(): Promise<void> }> {
	const manifestBytes = readFileSync(options.manifestPath);
	const manifest = JSON.parse(manifestBytes.toString('utf8')) as QualifiedNodeManifest;
	assert.equal(manifest.kind, 'soundscaper-qualified-node-artifacts'); assert.equal(manifest.schemaVersion, 1);
	const argv = [...process.argv], execArgv = [...process.execArgv];
	const nodeTestPath = argv[1] ? relative(options.repositoryRoot, resolve(argv[1])).replaceAll('\\', '/') : undefined;
	const testSource = manifest.selectedTests.find(test => test.path === nodeTestPath);
	if (!isMainThread || process.env.NODE_TEST_CONTEXT !== 'child-v8' || !testSource || !nodeTestPath) {
		return { active: false, async finish() { /* Ordinary tests retain their normal loaders and coverage. */ } };
	}
	assert.equal(qualifiedNodeHash(readFileSync(join(options.repositoryRoot, nodeTestPath))), testSource.sha256,
		'actual selected test bytes match the revision-bound prepared test');
	assert.equal(manifest.nodeVersion, process.versions.node, 'capture uses the prepared Node version');
	const coverageDirectory = process.env.NODE_V8_COVERAGE; assert.ok(coverageDirectory, 'ordinary V8 coverage must own the profiler');
	const outputRoot = resolve(options.outputRoot), preparedRoot = dirname(options.manifestPath);
	const modules = new Map<string, QualifiedNodeModule>(), code = new Map<string, string>();
	for (const module of manifest.modules) {
		if (!module.nodeTests.includes(nodeTestPath)) continue;
		assert.ok(!modules.has(module.sourceUrl), 'duplicate qualified module record');
		const source = readFileSync(join(preparedRoot, module.sourceFile));
		const generated = readFileSync(join(preparedRoot, module.codeFile), 'utf8');
		const mapBytes = readFileSync(join(preparedRoot, module.mapFile));
		assert.equal(qualifiedNodeHash(source), module.sourceSha256); assert.equal(source.byteLength, module.sourceBytes);
		assert.equal(qualifiedNodeHash(generated), module.generatedSha256); assert.equal(Buffer.byteLength(generated), module.generatedBytes);
		assert.equal(generated.length, module.generatedUtf16Length);
		assert.equal(qualifiedNodeHash(mapBytes), module.sourceMapSha256); assert.equal(mapBytes.byteLength, module.sourceMapBytes);
		assert.equal(generated.split('sourceMappingURL=').length, 2, 'one terminal map directive');
		assert.equal(module.inlineSourceMap.startOffset, generated.indexOf('//# sourceMappingURL='));
		assert.equal(module.inlineSourceMap.endOffset, generated.length);
		assert.equal(qualifiedNodeHash(generated.slice(module.inlineSourceMap.startOffset)), module.inlineSourceMap.trailerSha256);
		const encoded = /\/\/# sourceMappingURL=data:application\/json;base64,([^\n]+)\n?$/u.exec(generated)?.[1]; assert.ok(encoded);
		assert.deepEqual(Buffer.from(encoded, 'base64'), mapBytes);
		const map = JSON.parse(mapBytes.toString('utf8')) as { sources: string[]; sourcesContent: string[] };
		assert.deepEqual(map.sourcesContent, [source.toString('utf8')]); assert.equal(map.sources.length, 1);
		assert.equal(new URL(map.sources[0]!, module.sourceUrl).href, module.sourceUrl);
		assert.equal(fileURLToPath(module.sourceUrl), resolve(options.repositoryRoot, module.sourcePath));
		assert.deepEqual(readFileSync(fileURLToPath(module.sourceUrl)), source, 'original source preimage stays exact');
		modules.set(module.sourceUrl, module); code.set(module.sourceUrl, generated);
	}
	assert.ok(modules.size > 0, 'selected test owns at least one qualified source');
	const observations = new Map<string, ObservedSource>(), pending: Promise<void>[] = [], failures: unknown[] = [];
	const session = new Session(); session.connect();
	session.on('Debugger.scriptParsed', event => {
		const parsed = event.params, module = modules.get(parsed.url); if (!module) return;
		pending.push(session.post('Debugger.getScriptSource', { scriptId: parsed.scriptId }).then(result => {
			assert.equal(qualifiedNodeHash(result.scriptSource), module.generatedSha256,
				`actual runtime implementation differs from prepared bytes: ${module.sourcePath}`);
			assert.equal(result.scriptSource, code.get(parsed.url));
			assert.ok(!observations.has(parsed.scriptId), 'Inspector cannot rebind an isolate-local script identity');
			observations.set(parsed.scriptId, { scriptId: parsed.scriptId, url: parsed.url, sourcePath: module.sourcePath,
				actualSha256: qualifiedNodeHash(result.scriptSource), sourceMapURL: parsed.sourceMapURL ?? '', source: result.scriptSource });
		}).catch((error: unknown) => { failures.push(error); }));
	});
	try { await session.post('Debugger.enable'); } catch (error) { session.disconnect(); throw error; }
	let hooks: ReturnType<typeof registerHooks>;
	try {
		hooks = registerHooks({ load(url, context, nextLoad) {
			const prepared = code.get(url);
			return prepared === undefined ? nextLoad(url, context) : { format: 'module', source: prepared, shortCircuit: true };
		} });
	} catch (error) { session.disconnect(); throw error; }
	let completion: Promise<void> | undefined, completed: Omit<QualifiedNodeProfile['qualifiedNode'], 'status' | 'exitCode'> | undefined;
	let captured: Omit<QualifiedNodeProfile, 'qualifiedNode'> | undefined;
	const publish = (exitCode: number) => {
		if (!completed || !captured) return;
		const profile: QualifiedNodeProfile = { ...captured, qualifiedNode: { ...completed,
			status: exitCode === 0 ? 'passed' : 'failed', exitCode } };
		mkdirSync(join(outputRoot, 'captures'), { recursive: true });
		writeFileSync(join(outputRoot, 'captures', `${process.pid}-${threadId}.json`), `${JSON.stringify(profile)}\n`);
	};
	process.once('exit', publish);
	return { active: true,
		finish() { return completion ??= (async () => {
			try {
				await Promise.all(pending);
				if (failures.length) throw new AggregateError(failures, 'Qualified implementation runtime-byte attestation failed.');
				const normalCoverage = resolve(coverageDirectory); mkdirSync(normalCoverage, { recursive: true });
				const before = new Set(readdirSync(normalCoverage)); takeCoverage();
				// The final filename component is Node's actual threadId, not an OS PID.
				const ownerFile = new RegExp(`^coverage-${process.pid}-[0-9]+-${threadId}\\.json$`, 'u');
				const files = readdirSync(normalCoverage).filter(name => !before.has(name) && ownerFile.test(name));
				assert.ok(files.length > 0, 'actual native V8 checkpoint writes a raw profile');
				const result: QualifiedNodeScriptCoverage[] = [], maps: Record<string, unknown> = {}, sources: Record<string, string> = {};
				mkdirSync(join(outputRoot, 'raw'), { recursive: true });
				const rawFiles = files.map(name => {
					const bytes = readFileSync(join(normalCoverage, name)), profile = JSON.parse(bytes.toString('utf8')) as RawProfile;
					for (const entry of profile.result) {
						const module = modules.get(entry.url); if (!module) continue;
						const observed = observations.get(entry.scriptId); assert.ok(observed, 'eligible raw entry needs this isolate Inspector observation');
						assert.equal(observed.url, entry.url); assert.equal(observed.actualSha256, module.generatedSha256);
						assert.ok(entry.functions.length > 0 && entry.functions.some(fn => fn.isBlockCoverage), 'detailed function/block coverage required');
						assert.ok(entry.functions.every(fn => fn.isBlockCoverage || fn.ranges[0]?.count === 0), 'retain unexecuted lazy function denominator');
						const map = profile['source-map-cache']?.[entry.url]; assert.ok(map, 'normal Node map cache retains original-URL prepared map');
						maps[entry.url] = map; sources[entry.url] = observed.source; result.push(entry);
					}
					const path = `raw/${name}`; writeFileSync(join(outputRoot, path), bytes);
					return { path, sha256: qualifiedNodeHash(bytes), byteLength: bytes.byteLength };
				});
				captured = { result, 'script-source-cache': sources, 'source-map-cache': maps };
				completed = { kind: 'soundscaper-qualified-node-profile', schemaVersion: 1,
					manifestSha256: qualifiedNodeHash(manifestBytes), sourceRevision: manifest.sourceRevision, policyDigest: manifest.policyDigest,
					pid: process.pid, threadId, isMainThread, nodeTestPath, argv, execArgv, rawFiles,
					observations: [...observations.values()].map(({ source: _source, ...record }) => record) };
			} finally {
				try { hooks.deregister(); } finally {
					try { await session.post('Debugger.disable'); } finally { session.disconnect(); }
				}
			}
		})(); },
	};
}
