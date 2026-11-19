/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import test, { type TestContext } from 'node:test';

import {
	prepareQualifiedNodeArtifacts, qualifiedNodeHash,
	QUALIFIED_NODE_MANIFEST_ENV, QUALIFIED_NODE_OUTPUT_ENV,
	QUALIFIED_NODE_TESTS_ENV,
	type QualifiedNodeProfile,
} from '../scripts/lib/qualified-node-artifacts.ts';
import type {} from '../scripts/qualified-node-preload.ts';
import { compactV8Coverage } from '../scripts/lib/v8-coverage-compaction.mjs';

const repositoryRoot = resolve(import.meta.dirname, '..');
const sourcePath = 'src/common/foundation/abort-error.ts';
const source = readFileSync(join(repositoryRoot, sourcePath), 'utf8');
const selectedTest = 'tests/abort.test.ts';
const preload = join(repositoryRoot, 'scripts/qualified-node-dispatch.mjs');

function fixture(context: TestContext) {
	const root = mkdtempSync(join(tmpdir(), 'qualified-node-capture-'));
	context.after(() => { rmSync(root, { recursive: true, force: true }); });
	const write = (path: string, bytes: string) => {
		mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), bytes);
	};
	write(sourcePath, source);
	write('package.json', '{"type":"module"}\n'); write('package-lock.json', '{"lockfileVersion":3}\n');
	write('tests/browser/cancel.spec.js', '// Native-witness policy fixture; no runtime credit.\n');
	write(selectedTest, fixtureTestSource());
	execFileSync('git', ['init', '--quiet'], { cwd: root });
	execFileSync('git', ['add', '--', sourcePath, selectedTest, 'package.json', 'package-lock.json', 'tests/browser/cancel.spec.js'], { cwd: root });
	execFileSync('git', ['-c', 'user.name=Test fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '--quiet', '-m', 'Pin actual capture fixture'], { cwd: root });
	const revision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
	const policy = { kind: 'soundscaper-coverage-test-layers', schemaVersion: 1, defaultLayer: 'native',
		thresholds: { lines: 100, statements: 100, functions: 100, branches: 100 },
		sources: [{ path: sourcePath, layer: 'node-deterministic', sourceSha256: qualifiedNodeHash(source),
			nodeTests: [selectedTest], nativeWitness: { spec: 'tests/browser/cancel.spec.js', title: 'Native cancellation witness', surfaces: ['browser-chromium-soundscaper-renderer'] },
			reason: 'Pure cancellation reason and fallback decisions have deterministic complete Node coverage.' }] };
	const outputRoot = join(root, 'qualified'), raw = join(root, 'raw');
	const prepared = prepareQualifiedNodeArtifacts({ repositoryRoot: root, policy, selectedTestFiles: [join(root, selectedTest)], outputRoot, expectedRevision: revision });
	assert.ok(prepared);
	return { root, raw, outputRoot, prepared, policy, revision, write };
}

function execute(f: ReturnType<typeof fixture>, scenario = 'positive') {
	const env: NodeJS.ProcessEnv = { ...process.env, NODE_OPTIONS: '--max-old-space-size=2048', NODE_V8_COVERAGE: f.raw,
		[QUALIFIED_NODE_MANIFEST_ENV]: f.prepared.manifestPath, [QUALIFIED_NODE_OUTPUT_ENV]: f.outputRoot,
		[QUALIFIED_NODE_TESTS_ENV]: JSON.stringify([join(f.root, selectedTest)]),
		SCAPE_CAPTURE_FIXTURE_SCENARIO: scenario };
	delete env.NODE_TEST_CONTEXT;
	const result = spawnSync(process.execPath, ['--import', preload, '--test', '--test-concurrency=1', join(f.root, selectedTest)], {
		cwd: f.root, env, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024,
	});
	assert.ifError(result.error); assert.equal(result.signal, null);
	return result;
}

function profiles(f: ReturnType<typeof fixture>): QualifiedNodeProfile[] {
	const directory = join(f.outputRoot, 'captures');
	return existsSync(directory) ? readdirSync(directory).map(name => JSON.parse(readFileSync(join(directory, name), 'utf8')) as QualifiedNodeProfile) : [];
}

test('selected real Node child captures exact prepared code, untouched raw data, and its actual passed exit', context => {
	const f = fixture(context), result = execute(f); assert.equal(result.status, 0, result.stderr || result.stdout);
	const captures = profiles(f); assert.equal(captures.length, 1);
	const profile = captures[0]!; assert.equal(profile.result.length, 1);
	assert.equal(profile.qualifiedNode.status, 'passed'); assert.equal(profile.qualifiedNode.exitCode, 0);
	assert.equal(profile.qualifiedNode.threadId, 0); assert.equal(profile.qualifiedNode.isMainThread, true);
	assert.equal(profile.qualifiedNode.nodeTestPath, selectedTest);
	assert.equal(f.prepared.manifest.selectedTests[0]!.sha256, qualifiedNodeHash(readFileSync(join(f.root, selectedTest))));
	const module = f.prepared.manifest.modules[0]!;
	assert.equal(profile['script-source-cache'][module.sourceUrl], readFileSync(join(f.outputRoot, module.codeFile), 'utf8'));
	assert.equal(profile.qualifiedNode.observations[0]!.actualSha256, module.generatedSha256);
	for (const raw of profile.qualifiedNode.rawFiles) {
		const bytes = readFileSync(join(f.outputRoot, raw.path));
		assert.equal(qualifiedNodeHash(bytes), raw.sha256); assert.equal(bytes.byteLength, raw.byteLength);
		assert.deepEqual(bytes, readFileSync(join(f.raw, raw.path.slice('raw/'.length))), 'ordinary c8 input is unchanged');
		assert.match(raw.path, new RegExp(`^raw/coverage-${profile.qualifiedNode.pid}-[0-9]+-0\\.json$`, 'u'));
		const actual = JSON.parse(bytes.toString('utf8')) as { result: QualifiedNodeProfile['result'] };
		for (const entry of profile.result) assert.ok(actual.result.some(candidate => JSON.stringify(candidate) === JSON.stringify(entry)));
	}
});

test('a failing real test cannot publish a passed receipt even after executing the complete source', context => {
	const f = fixture(context), result = execute(f, 'failed-test'); assert.equal(result.status, 1);
	const captures = profiles(f); assert.equal(captures.length, 1);
	assert.equal(captures[0]!.qualifiedNode.status, 'failed'); assert.equal(captures[0]!.qualifiedNode.exitCode, 1);
});

test('same original URL with authentic inline map cannot credit a mocked implementation', context => {
	const f = fixture(context), result = execute(f, 'implementation-mock'); assert.equal(result.status, 1);
	assert.match(result.stderr + result.stdout, /runtime-byte attestation failed/u); assert.deepEqual(profiles(f), []);
});

test('an unselected test keeps its ordinary mock and cannot capture qualified source', context => {
	const f = fixture(context);
	f.write('tests/unselected.test.ts', `import assert from 'node:assert/strict';\nimport test from 'node:test';\nimport {registerHooks} from 'node:module';\nconst sourceUrl=${JSON.stringify(f.prepared.manifest.modules[0]!.sourceUrl)};\nconst hooks=registerHooks({load(url,context,nextLoad){return url===sourceUrl?{format:'module',shortCircuit:true,source:'export const ordinary=37;'}:nextLoad(url,context);}});\ntest('ordinary mock remains',async()=>{try{assert.equal((await import(sourceUrl)).ordinary,37);}finally{hooks.deregister();}});\n`);
	const env: NodeJS.ProcessEnv = { ...process.env, NODE_OPTIONS: '--max-old-space-size=2048', NODE_V8_COVERAGE: f.raw,
		[QUALIFIED_NODE_MANIFEST_ENV]: f.prepared.manifestPath, [QUALIFIED_NODE_OUTPUT_ENV]: f.outputRoot,
		[QUALIFIED_NODE_TESTS_ENV]: JSON.stringify([join(f.root, selectedTest)]) };
	delete env.NODE_TEST_CONTEXT;
	const result = spawnSync(process.execPath, ['--import', preload, '--test', join(f.root, 'tests/unselected.test.ts')], { cwd: f.root, env, encoding: 'utf8' });
	assert.ifError(result.error); assert.equal(result.status, 0, result.stderr); assert.deepEqual(profiles(f), []);
});

test('a genuine same-PID worker without its own Inspector capture cannot borrow the main receipt', context => {
	const f = fixture(context), module = f.prepared.manifest.modules[0]!;
	f.write('worker.mjs', `import{readFileSync}from'node:fs';import{registerHooks}from'node:module';import{takeCoverage}from'node:v8';import{workerData}from'node:worker_threads';const source=readFileSync(workerData.code,'utf8');const hook=registerHooks({load(url,context,nextLoad){return url===workerData.url?{format:'module',shortCircuit:true,source}:nextLoad(url,context);}});try{const actual=await import(workerData.url);actual.throwIfAborted(undefined,'worker');actual.createAbortGuard('worker')();takeCoverage();}finally{hook.deregister();}\n`);
	const result = execute(f, 'worker-only'); assert.equal(result.status, 0, result.stderr || result.stdout);
	const captures = profiles(f); assert.equal(captures.length, 1); assert.deepEqual(captures[0]!.result, []);
	assert.deepEqual(captures[0]!.qualifiedNode.observations, []);
	const workerNames = readdirSync(f.raw).filter(name => /-[1-9][0-9]*\.json$/u.test(name));
	assert.ok(workerNames.length > 0);
	assert.ok(workerNames.some(name => {
		const raw = JSON.parse(readFileSync(join(f.raw, name), 'utf8')) as { result: QualifiedNodeProfile['result'] };
		return raw.result.some(entry => entry.url === module.sourceUrl);
	}), 'real prepared module executed in a different isolate, without qualified credit');
});

test('prepared source tampering and changed selected test bytes fail before source execution', context => {
	const f = fixture(context), module = f.prepared.manifest.modules[0]!;
	const path = join(f.outputRoot, module.codeFile), original = readFileSync(path, 'utf8');
	writeFileSync(path, `${original}\n// altered\n`);
	assert.equal(execute(f).status, 1); assert.deepEqual(profiles(f), []);
	writeFileSync(path, original); f.write(selectedTest, `${fixtureTestSource()}\n// changed after preparation\n`);
	assert.equal(execute(f).status, 1); assert.deepEqual(profiles(f), []);
});

test('unrelated selections perform no Git compilation or output creation', context => {
	const f = fixture(context), outputRoot = join(f.root, 'unrelated');
	assert.equal(prepareQualifiedNodeArtifacts({ repositoryRoot: f.root, policy: f.policy,
		selectedTestFiles: ['tests/unrelated.test.ts'], outputRoot, expectedRevision: 'not-a-revision' }), null);
	assert.equal(existsSync(outputRoot), false);
});

test('preparation requires source and test bytes to match the declared Git revision', context => {
	const f = fixture(context); f.write(sourcePath, `${source}\n// changed\n`);
	assert.throws(() => prepareQualifiedNodeArtifacts({ repositoryRoot: f.root, policy: f.policy,
		selectedTestFiles: [selectedTest], outputRoot: join(f.root, 'stale'), expectedRevision: f.revision }), /source SHA-256/u);
});

test('actual prepared, native stripped, and tsx layouts keep separate geometry through normal c8 compaction', context => {
	const f = fixture(context); assert.equal(execute(f).status, 0);
	const ordinaryPath = 'tests/ordinary.test.ts';
	f.write(ordinaryPath, `import test from 'node:test';import {throwIfAborted,createAbortGuard} from '../${sourcePath}';test('ordinary native source',()=>{throwIfAborted(undefined,'live');createAbortGuard('bound')();});\n`);
	const env: NodeJS.ProcessEnv = { ...process.env, NODE_OPTIONS: '--max-old-space-size=2048', NODE_V8_COVERAGE: f.raw };
	delete env.NODE_TEST_CONTEXT; delete env[QUALIFIED_NODE_MANIFEST_ENV]; delete env[QUALIFIED_NODE_OUTPUT_ENV]; delete env[QUALIFIED_NODE_TESTS_ENV];
	for (const loaders of [[], ['--import', pathToFileURL(join(repositoryRoot, 'node_modules/tsx/dist/loader.mjs')).href]]) {
		const result = spawnSync(process.execPath, [...loaders, '--test', join(f.root, ordinaryPath)], { cwd: f.root, env, encoding: 'utf8' });
		assert.ifError(result.error); assert.equal(result.status, 0, result.stderr || result.stdout);
	}
	const compacted = compactV8Coverage(f.raw, f.root) as { result: QualifiedNodeProfile['result']; 'source-map-cache': Record<string, unknown> };
	const layouts = compacted.result.filter(entry => entry.url.includes('/src/common/foundation/abort-error.ts'));
	assert.equal(layouts.length, 3, 'three actual executable layouts remain separate before original-source remapping');
	assert.equal(layouts.filter(entry => entry.url.endsWith('.js')).length, 2, 'mapped prepared and tsx code use separate content addresses');
	const compactedDirectory = join(f.root, 'compacted'); mkdirSync(compactedDirectory);
	writeFileSync(join(compactedDirectory, 'merged.json'), JSON.stringify(compacted));
	const config = join(f.root, 'c8.json'); f.write('c8.json', JSON.stringify({ all: true, include: [sourcePath], extension: ['.ts', '.js'], exclude: [], 'exclude-after-remap': true, reporter: ['json-summary'] }));
	const reportEnv: NodeJS.ProcessEnv = { ...env }; delete reportEnv.NODE_V8_COVERAGE;
	const reports = join(f.root, 'c8-report');
	const reported = spawnSync(process.execPath, [join(repositoryRoot, 'node_modules/c8/bin/c8.js'), 'report', `--config=${config}`,
		`--temp-directory=${compactedDirectory}`, `--reports-dir=${reports}`], { cwd: f.root, env: reportEnv, encoding: 'utf8' });
	assert.ifError(reported.error); assert.equal(reported.status, 0, reported.stderr);
	const summary = JSON.parse(readFileSync(join(reports, 'coverage-summary.json'), 'utf8')) as { total: Record<string, { pct: number }> };
	for (const metric of ['lines', 'statements', 'functions', 'branches']) assert.equal(summary.total[metric]!.pct, 100, metric);
});

function fixtureTestSource(): string {
	return `import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {registerHooks} from 'node:module';
import {Worker} from 'node:worker_threads';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
const url=new URL('../${sourcePath}',import.meta.url).href;
test('actual abort source behavior',async()=>{
 const scenario=process.env.SCAPE_CAPTURE_FIXTURE_SCENARIO;
 let hooks;
 if(scenario==='worker-only'){
  const manifestPath=process.env.SCAPE_QUALIFIED_NODE_MANIFEST;
  const manifest=JSON.parse(readFileSync(manifestPath,'utf8'));
  const worker=new Worker(new URL('../worker.mjs',import.meta.url),{workerData:{url,code:join(dirname(manifestPath),manifest.modules[0].codeFile)}});
  await new Promise((resolve,reject)=>{worker.once('error',reject);worker.once('exit',code=>{if(code===0)resolve();else reject(new Error('worker exit '+code));});});
  return;
 }
 if(scenario==='implementation-mock'){
  const manifest=JSON.parse(readFileSync(process.env.SCAPE_QUALIFIED_NODE_MANIFEST,'utf8'));
  const code=readFileSync(new URL(manifest.modules[0].codeFile,new URL('file://'+process.env.SCAPE_QUALIFIED_NODE_MANIFEST)),'utf8');
  const trailer=code.slice(code.indexOf('//# sourceMappingURL='));
  hooks=registerHooks({load(candidate,context,nextLoad){return candidate===url?{format:'module',shortCircuit:true,source:'export function throwIfAborted(){};export function createAbortGuard(){return()=>{};}\\n'+trailer}:nextLoad(candidate,context);}});
 }
 try{
  const {throwIfAborted,createAbortGuard}=await import(url);
  throwIfAborted(undefined,'live');
  if(scenario==='implementation-mock')return;
  throwIfAborted(null,'live');throwIfAborted(new AbortController().signal,'live');
  const reason=Symbol('actual cancellation'),stopped=AbortSignal.abort(reason);
  assert.throws(()=>throwIfAborted(stopped,'ignored'),error=>error===reason);
  const signal=AbortSignal.abort();const own=Object.getOwnPropertyDescriptor(signal,'reason');
  Object.defineProperty(signal,'reason',{configurable:true,value:undefined});
  const dom=Object.getOwnPropertyDescriptor(globalThis,'DOMException');
  try{
   assert.throws(()=>throwIfAborted(signal,'platform'),{name:'AbortError',message:'platform'});
   Object.defineProperty(globalThis,'DOMException',{configurable:true,value:undefined});
   assert.throws(()=>throwIfAborted(signal,'fallback'),{name:'AbortError',message:'fallback'});
  }finally{Object.defineProperty(globalThis,'DOMException',dom);if(own)Object.defineProperty(signal,'reason',own);else Reflect.deleteProperty(signal,'reason');}
  const guard=createAbortGuard('bound');guard();assert.throws(()=>guard(stopped),error=>error===reason);
  if(scenario==='failed-test')assert.fail('actual test failure after complete source execution');
 }finally{hooks?.deregister();}
});\n`;
}
