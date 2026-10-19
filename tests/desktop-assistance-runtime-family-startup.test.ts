/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

import {
	createAssistanceRuntimeFamilyDesktopStartup,
} from '../desktop/assistance-runtime-family-startup.ts';
import {
	ASSISTANCE_RUNTIME_FAMILY_DEFINITIONS,
	ASSISTANCE_RUNTIME_FAMILY_TARGETS,
	type AssistanceRuntimeFamilyId,
} from '../desktop/assistance-runtime-family-manifest.ts';

import { createAssistanceFramePackV1 } from
	'../src/common/editor/assistance/binary-formats-v1.ts';

const GIB = 1024 ** 3;

function packageGeneratedManifest(familyId: AssistanceRuntimeFamilyId) {
	const definition = ASSISTANCE_RUNTIME_FAMILY_DEFINITIONS[familyId];
	return {
		schemaVersion: 1,
		familyId,
		runtimeVersion: definition.runtimeVersion,
		source: { url: definition.sourceUrl, revision: definition.sourceRevision },
		executionProvider: 'cpu',
		runtimePrefix: `assistance/${familyId}/${definition.runtimeVersion}`,
		targets: ASSISTANCE_RUNTIME_FAMILY_TARGETS.map((id) => ({
			id, status: 'package-generated',
			packageBehavior: 'The target package build generates and verifies this runtime payload.',
		})),
	};
}

function startup(manifests?: Readonly<Partial<Record<AssistanceRuntimeFamilyId, unknown>>>) {
	let forks = 0;
	const runtime = createAssistanceRuntimeFamilyDesktopStartup({
		runtimeRoot: resolve('fixture-runtime'),
		helperPath: resolve('fixture-runtime-family-helper.js'),
		...(manifests === undefined ? {} : { manifests }),
		platform: 'linux', architecture: 'x64',
		fork: () => { forks += 1; throw new Error('No unpackaged runtime may fork.'); },
		totalMemoryBytes: () => 32 * GIB,
		availableMemoryBytes: () => 24 * GIB,
	});
	return { runtime, forkCount: () => forks };
}

test('desktop startup reports every absent runtime manifest as typed unavailable without spawning', async () => {
	const { runtime, forkCount } = startup();
	for (const familyId of Object.keys(
		ASSISTANCE_RUNTIME_FAMILY_DEFINITIONS,
	) as AssistanceRuntimeFamilyId[]) {
		assert.deepEqual(await runtime.availability(familyId), {
			status: 'unavailable',
			reason: 'manifest-missing',
			detail: `The ${familyId} runtime has no admitted payload manifest.`,
		});
		assert.deepEqual(runtime.snapshot(familyId), {
			familyId, state: 'idle', processSpawned: false,
			recentCrashes: 0, quarantined: false,
		});
	}
	assert.equal(typeof runtime.operations.run, 'function');
	assert.equal(forkCount(), 0);
	await runtime.shutdown();
	assert.equal(runtime.snapshot('onnxruntime-node').state, 'disposed');
});

test('package-generated runtime templates cannot spawn before packaging supplies their bytes', async () => {
	const manifests = Object.freeze({
		'onnxruntime-node': packageGeneratedManifest('onnxruntime-node'),
		'whisper-cpp': packageGeneratedManifest('whisper-cpp'),
		'llama-cpp': packageGeneratedManifest('llama-cpp'),
	});
	const { runtime, forkCount } = startup(manifests);
	for (const familyId of Object.keys(manifests) as AssistanceRuntimeFamilyId[]) {
		const status = await runtime.availability(familyId);
		assert.equal(status.status, 'unavailable');
		if (status.status === 'unavailable') {
			assert.equal(status.reason, 'payload-not-packaged');
			assert.match(status.detail, /package build/iu);
		}
	}
	assert.equal(forkCount(), 0);
	runtime.dispose();
});

test('first-use family availability forwards job cancellation into runtime preparation', async () => {
	const controller = new AbortController();
	let observed: AbortSignal | undefined;
	const onnx = packageGeneratedManifest('onnxruntime-node');
	const manifest = { ...onnx, targets: onnx.targets.map((target) => target.id === 'linux-x64'
		? { id: target.id, status: 'authenticated', entrypoint: 'runtime',
			files: [{ path: 'runtime', byteLength: 1, sha256: 'a'.repeat(64), executable: false }] }
		: target) };
	const runtime = createAssistanceRuntimeFamilyDesktopStartup({
		runtimeRoot: resolve('fixture-runtime'),
		helperPath: resolve('fixture-runtime-family-helper.js'),
		manifests: { 'onnxruntime-node': manifest },
		platform: 'linux', architecture: 'x64',
		fork: () => { throw new Error('No runtime should spawn.'); },
		totalMemoryBytes: () => 32 * GIB,
		availableMemoryBytes: () => 24 * GIB,
		ensureRuntime: async (_familyId, signal) => { observed = signal; signal?.throwIfAborted(); },
	});
	await runtime.availability('onnxruntime-node', controller.signal);
	assert.equal(observed, controller.signal);
	controller.abort();
	await assert.rejects(runtime.availability('onnxruntime-node', controller.signal), /abort/iu);
	runtime.dispose();
});

test('startup refuses foreign manifest keys before exposing operation routing', () => {
	assert.throws(() => startup({ shell: packageGeneratedManifest('onnxruntime-node') } as never),
		/manifest.*family|key|inventory/iu);
});

test('startup uses the supplied power port when admitting an operation', async (t) => {
	const root = await mkdtemp(join(tmpdir(), 'assistance-startup-power-'));
	t.after(() => rm(root, { recursive: true, force: true }));
	const inputPath = join(root, 'frames.pack');
	const modelPath = join(root, 'network.onnx');
	const outputPath = join(root, 'shots.json');
	const input = Buffer.concat(createAssistanceFramePackV1({ width: 48, height: 27,
		timescale: 1_000, frames: [{ sourceFrame: 0, presentationTick: '0',
			rgba: new Uint8Array(48 * 27 * 4) }] }));
	const model = Uint8Array.of(1);
	await Promise.all([writeFile(inputPath, input), writeFile(modelPath, model),
		writeFile(outputPath, new Uint8Array())]);
	let observations = 0;
	let forks = 0;
	const runtime = createAssistanceRuntimeFamilyDesktopStartup({
		runtimeRoot: join(root, 'runtime'), helperPath: join(root, 'helper.js'),
		platform: 'linux', architecture: 'x64',
		fork: () => { forks += 1; throw new Error('no runtime is installed'); },
		powerEtiquette: Object.freeze({
			observe: () => {
				observations += 1;
				return Object.freeze({ onBatteryPower: false, thermalState: 'nominal' as const });
			},
			subscribe: () => { throw new Error('mains power must not arm a hold'); },
		}),
		totalMemoryBytes: () => 32 * GIB, availableMemoryBytes: () => 24 * GIB,
	});
	t.after(() => runtime.shutdown());
	const jobId = '1'.repeat(40);
	const outcome = await runtime.operations.run({
		jobId, task: 'shot-detection', maximumRssBytes: GIB, maximumDurationMs: 60_000,
		settings: { schemaVersion: 1, operation: 'shot-detection',
			inputRoles: ['frame-pack'], outputRoles: ['shot-boundaries'] },
		inputs: [{ claim: { claimVersion: 1, claimId: '2'.repeat(40), jobId,
			role: 'frame-pack', mediaType: 'application/vnd.soundscaper.frame-pack',
			byteLength: input.byteLength, sha256: createHash('sha256').update(input).digest('hex') },
			path: inputPath }],
		models: [{ modelId: 'transnetv2', version: '1.0.0', artifactRole: 'network',
			path: modelPath, byteLength: model.byteLength,
			sha256: createHash('sha256').update(model).digest('hex') }],
		outputs: [{ reservation: { claimVersion: 1, claimId: '3'.repeat(40), jobId,
			role: 'shot-boundaries', mediaType: 'application/vnd.soundscaper.shot-boundaries+json',
			maximumByteLength: 1_024 }, path: outputPath }],
	});
	assert.deepEqual(outcome, { outcome: 'unavailable', reason: 'runtime-unavailable' });
	assert.equal(observations, 1);
	assert.equal(forks, 0);
});
