/* SPDX-License-Identifier: AGPL-3.0-only */

/** Optional heavy offline diagnostic. Uses the conversion tool's locked Python environment; never publishes. */

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { pathToFileURL } from 'node:url';
import { gunzipSync } from 'node:zlib';

import { CORRIDORKEY_CHROMA_HINT_DEFAULTS } from '../../src/common/editor/assistance/corridorkey-hint-settings.ts';
import { createChromaKeyMatte } from '../../src/common/editor/video-chroma-key.ts';
import { createCorridorKeyOnnxFrameProcessorV1 } from '../../desktop/assistance-corridorkey-inference.ts';
import { CORRIDORKEY_GRAPH_ARTIFACTS_V1 } from '../../desktop/assistance-corridorkey-model.ts';
import { createAssistanceOnnxAcceleratedRuntimeV1 } from '../../desktop/assistance-onnx-acceleration.ts';
import { reviewAssistanceOnnxRuntimeModuleV1 } from '../../desktop/assistance-onnx-worker-common.ts';
import type { AssistanceOnnxRuntimeModuleV1 } from '../../desktop/assistance-onnx-runtime-worker.ts';
import { validateAssistanceRuntimeDistribution } from '../../desktop/assistance-runtime-distribution.ts';

interface Pin { readonly path: string; readonly byteLength: number; readonly sha256: string }
interface Snapshot { readonly sourceRevision: string; readonly files: Readonly<Record<string, string>> }
interface Conversion {
	readonly registerSha256: string;
	readonly toolchainLockSha256: string;
	readonly environment: Readonly<Record<string, string>>;
	readonly conversionToolFiles: readonly { readonly fileName: string; readonly byteLength: number; readonly sha256: string }[];
}
interface ReferenceIdentity { readonly sourceRevision: string; readonly trackedSourceFiles: number;
	readonly environment: Readonly<Record<string, string>> }
const root = resolve(import.meta.dirname, '../..');
const runner = 'scripts/models/validate-corridorkey-production-cpu-candidate.ts';
const referenceHelper = 'scripts/models/corridorkey-production-cpu-reference.py';
const sourceRegister = 'config/framescaper-corridorkey-model-source-candidate.json';
const toolRoot = 'scripts/models/corridorkey-conversion-tool';
const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
const json = async <T>(path: string): Promise<T> => JSON.parse(await readFile(path, 'utf8')) as T;

async function pin(path: string): Promise<Pin> {
	const absolute = resolve(root, path);
	const metadata = await lstat(absolute);
	if (!metadata.isFile() || metadata.isSymbolicLink() || await realpath(absolute) !== absolute) {
		throw new Error(`The diagnostic requires a regular direct source/artifact path: ${path}`);
	}
	const hash = createHash('sha256');
	for await (const chunk of createReadStream(absolute)) hash.update(chunk as Buffer);
	return { path, byteLength: metadata.size, sha256: hash.digest('hex') };
}

async function assertPin(path: string, expected: Readonly<{ byteLength: number; sha256: string }>): Promise<void> {
	const actual = await pin(path);
	if (actual.byteLength !== expected.byteLength || actual.sha256 !== expected.sha256) {
		throw new Error(`The diagnostic byte identity differs: ${path}`);
	}
}

export function createCorridorKeyCpuDiagnosticFrameV1(ordinal: number): Uint8Array {
	if (ordinal !== 0 && ordinal !== 1) throw new RangeError('The diagnostic defines exactly two ordered fixture frames.');
	const rgba = new Uint8Array(256 * 256 * 4);
	for (let y = 0; y < 256; y += 1) for (let x = 0; x < 256; x += 1) {
		const inside = ((x - 128 - ordinal * 2) / 45) ** 2 + ((y - 135) / 90) ** 2 < 1;
		rgba.set(inside ? [180, 130, 95, 255] : [12, 205, 10, 255], (y * 256 + x) * 4);
	}
	return rgba;
}

async function files(directory: string, prefix = ''): Promise<string[]> {
	const result: string[] = [];
	for (const entry of await readdir(directory, { withFileTypes: true })) {
		if (entry.isSymbolicLink()) throw new Error('The runtime diagnostic does not admit indirect inventory entries.');
		const name = prefix + entry.name;
		if (entry.isDirectory()) result.push(...await files(join(directory, entry.name), name + '/'));
		else if (entry.isFile()) result.push(name);
		else throw new Error('The runtime diagnostic requires regular inventory entries.');
	}
	return result.sort();
}

async function main(): Promise<void> {
	if (process.platform !== 'linux' || process.arch !== 'x64' || process.version !== 'v26.5.0') {
		throw new Error('This retained diagnostic is scoped to Linux x64 and Node 26.5.0.');
	}
	const flags = ['--runtime-root', '--runtime-archive', '--model-root', '--source-root', '--python', '--output'];
	const args = process.argv.slice(2);
	const options = new Map<string, string>();
	for (let index = 0; index < args.length; index += 2) {
		if (!flags.includes(args[index]!) || !args[index + 1] || options.has(args[index]!)) throw new Error('Invalid or repeated CPU diagnostic arguments.');
		options.set(args[index]!, resolve(args[index + 1]!));
	}
	if (options.size !== flags.length) throw new Error(`Required arguments: ${flags.join(' ')}`);
	const started = performance.now();
	const snapshotPath = 'config/desktop-test-assistance-runtime-snapshots/linux-x64.json.gz';
	const lock = await json<{ readonly targets: Readonly<Record<string, Pin & { readonly sourceRevision: string }>> }>(join(root, 'config/desktop-test-assistance-runtime-snapshots.json'));
	const expectedSnapshot = lock.targets['linux-x64']!;
	await assertPin(snapshotPath, expectedSnapshot);
	const snapshot = JSON.parse(gunzipSync(await readFile(join(root, snapshotPath)), { maxOutputLength: 12 * 1024 ** 2 }).toString('utf8')) as Snapshot;
	if (snapshot.sourceRevision !== expectedSnapshot.sourceRevision) throw new Error('Runtime snapshot source revision differs.');
	const distribution = validateAssistanceRuntimeDistribution(JSON.parse(snapshot.files['config/assistance-runtime-distribution.json']!), 'linux-x64');
	const bundle = distribution.bundles.find(row => row.familyId === 'onnxruntime-node')!;
	const runtimeRoot = options.get('--runtime-root')!;
	await assertPin(options.get('--runtime-archive')!, bundle.archive);
	if (JSON.stringify(await files(runtimeRoot)) !== JSON.stringify(bundle.files.map(row => row.path))) throw new Error('Runtime file inventory differs.');
	for (const row of bundle.files) await assertPin(join(runtimeRoot, row.path), row);
	const modelPaths = {} as Record<typeof CORRIDORKEY_GRAPH_ARTIFACTS_V1[number]['role'], string>;
	for (const row of CORRIDORKEY_GRAPH_ARTIFACTS_V1) {
		const path = join(options.get('--model-root')!, row.fileName);
		await assertPin(path, row);
		modelPaths[row.role] = path;
	}
	const conversionPath = 'evidence/framescaper-corridorkey-conversion-candidate.json';
	const conversion = await json<Conversion>(join(root, conversionPath));
	if ((await pin(sourceRegister)).sha256 !== conversion.registerSha256
		|| (await pin(`${toolRoot}/uv.lock`)).sha256 !== conversion.toolchainLockSha256) throw new Error('Conversion source register or Python lock differs.');
	for (const row of conversion.conversionToolFiles) await assertPin(`${toolRoot}/${row.fileName}`, row);
	const loaded: unknown = await import(pathToFileURL(join(runtimeRoot, 'node_modules/onnxruntime-node/dist/index.js')).href);
	const native = reviewAssistanceOnnxRuntimeModuleV1(loaded, { value: 'Invalid verified runtime', surface: 'Incomplete verified runtime' });
	const environment = loaded as { readonly env?: { readonly versions?: { readonly node?: string } } };
	if (environment.env?.versions?.node !== '1.29.0') throw new Error('Production ONNX engine version differs.');
	const sessions: { readonly fileName: string; readonly providers: readonly string[] }[] = [];
	const observed: AssistanceOnnxRuntimeModuleV1 = { Tensor: native.Tensor, InferenceSession: { create: async (path, settings) => {
		const session = await native.InferenceSession.create(path, settings);
		sessions.push({ fileName: relative(options.get('--model-root')!, path), providers: [...settings.executionProviders] });
		return session;
	} } };
	// This explicit CPU diagnostic certifies schema/kernel compatibility, never GPU execution.
	const runtime = createAssistanceOnnxAcceleratedRuntimeV1(observed, { executionProviders: ['cpu'] });
	let processor: Awaited<ReturnType<typeof createCorridorKeyOnnxFrameProcessorV1>> | undefined;
	const child = spawn(options.get('--python')!, ['-u', '-B', join(root, referenceHelper), options.get('--source-root')!, join(root, sourceRegister)],
		{ env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' }, stdio: ['pipe', 'pipe', 'inherit'] });
	child.stdin.on('error', () => {});
	const exit = new Promise<void>((resolveExit, reject) => {
		child.once('error', reject);
		child.once('exit', code => code === 0 ? resolveExit() : reject(new Error(`Source reference exited with code ${String(code)}.`)));
	});
	void exit.catch(() => {});
	const lines = createInterface({ input: child.stdout })[Symbol.asyncIterator]();
	const next = async <T>(): Promise<T> => {
		const line = await lines.next();
		if (line.done) throw new Error('The source reference ended early.');
		return JSON.parse(line.value) as T;
	};
	const referenceDigest = createHash('sha256');
	const frames: Record<string, number | string>[] = [];
	const hintedFrames: Record<string, number | string>[] = [];
	let reference: ReferenceIdentity;
	try {
		reference = await next<ReferenceIdentity>();
		for (const name of ['torch', 'numpy']) if (reference.environment[name] !== conversion.environment[name]) throw new Error('Source reference environment differs from the locked conversion.');
		for (const mode of ['none', 'chroma-key'] as const) {
			processor = await createCorridorKeyOnnxFrameProcessorV1({ runtime, modelPaths,
				hint: mode === 'chroma-key' ? CORRIDORKEY_CHROMA_HINT_DEFAULTS : undefined });
			for (let ordinal = 0; ordinal < 2; ordinal += 1) {
				const rgba = createCorridorKeyCpuDiagnosticFrameV1(ordinal);
				const matte = mode === 'chroma-key' ? createChromaKeyMatte({ width: 256, height: 256, rgba }, CORRIDORKEY_CHROMA_HINT_DEFAULTS) : undefined;
				const result = await processor.process({ width: 256, height: 256, rgba });
				await new Promise<void>((resolveWrite, reject) => child.stdin.write(JSON.stringify({ ordinal, hintMode: mode, rgba: Buffer.from(rgba).toString('base64'),
					hint: matte ? Buffer.from(matte.buffer).toString('base64') : undefined }) + '\n', error => error ? reject(error) : resolveWrite()));
				const reply = await next<{ readonly ordinal: number; readonly rgba: string }>();
				const expected = Buffer.from(reply.rgba, 'base64');
				if (reply.ordinal !== ordinal || expected.length !== rgba.length) throw new Error('Source reference frame identity/geometry differs.');
				if (mode === 'none') referenceDigest.update(expected);
				let maximumRgbaError = 0, transparent = 0, partial = 0, opaque = 0;
				for (let index = 0; index < rgba.length; index += 1) {
					maximumRgbaError = Math.max(maximumRgbaError, Math.abs(result.rgba[index]! - expected[index]!));
					if (index % 4 === 3) {
						const alpha = result.rgba[index]!;
						if (alpha === 0) transparent += 1; else if (alpha === 255) opaque += 1; else partial += 1;
					}
				}
				if (maximumRgbaError > 1) throw new Error(`Production/source RGBA parity exceeded one byte: ${maximumRgbaError}`);
				(mode === 'none' ? frames : hintedFrames).push({ ordinal, inputRgbaSha256: sha256(rgba), referenceRgbaSha256: sha256(expected), nativeRgbaSha256: sha256(result.rgba),
					maximumRgbaError, transparent, partial, opaque });
				console.error(`Production CPU ${mode} frame ${ordinal} passed with maximum RGBA error ${maximumRgbaError}.`);
			}
			await processor.release(); processor = undefined;
		}
	} finally {
		child.stdin.end();
		await processor?.release();
	}
	await exit;
	const processorSources = ['desktop/assistance-corridorkey-inference.ts', 'desktop/assistance-corridorkey-hint.ts',
		'src/common/editor/video-chroma-key.ts', 'src/common/editor/assistance/corridorkey-hint-settings.ts', 'src/common/editor/assistance/corridorkey-pixels-v1.ts',
		'desktop/assistance-onnx-acceleration.ts', 'desktop/assistance-onnx-visual-tensors.ts', 'desktop/assistance-onnx-visual-worker-common.ts'];
	const report = {
		schemaVersion: 1, status: 'local-production-engine-cpu-parity-passed', publicationReady: false, gpuValidated: false,
		modelId: 'corridorkey-2.0', measuredAt: new Date().toISOString(),
		validationScope: 'Two synthetic 256 by 256 recurrent frames per mode, without hints and with normal Chroma Key hints, on authenticated Linux x64 production ONNX 1.29 CPU; no desktop GPU or publication evidence.',
		environment: { target: 'linux-x64', node: process.version, runtimeVersion: '1.29.0' },
		runtime: { provider: 'cpu', snapshot: { ...await pin(snapshotPath), sourceRevision: expectedSnapshot.sourceRevision }, archive: bundle.archive, fileCount: bundle.files.length },
		provenance: { conversionReport: await pin(conversionPath), sourceRegister: await pin(sourceRegister), toolchainLock: await pin(`${toolRoot}/uv.lock`),
			processorSources: await Promise.all(processorSources.map(pin)), runnerSources: await Promise.all([runner, referenceHelper].map(pin)) },
		reference: { ...reference, fixture: { name: 'moving-ellipse-green-screen-rgba8-v1', width: 256, height: 256, frameCount: 2,
			referenceRgbaSha256: referenceDigest.digest('hex') } },
		graphs: CORRIDORKEY_GRAPH_ARTIFACTS_V1, sessions: sessions.slice(0, 5), frames,
		hintValidation: { settings: CORRIDORKEY_CHROMA_HINT_DEFAULTS, sessions: sessions.slice(5), frames: hintedFrames },
		invocation: ['node', '--import', 'tsx', runner, ...args], elapsedSeconds: Math.round((performance.now() - started) / 100) / 10,
	};
	await writeFile(options.get('--output')!, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
	console.error(`Retained unpublished CPU candidate evidence: ${options.get('--output')!}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
