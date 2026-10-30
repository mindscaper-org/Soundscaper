/* SPDX-License-Identifier: AGPL-3.0-only */

/** Prepare the authenticated neural closure independently of desktop application packaging. */

import { createHash } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { buildKokoroG2pBundle } from '../kokoro-g2p/build.mjs';
import { stageDesktopAssistanceRuntimeDistribution } from './desktop-assistance-runtime-distribution.mjs';
import { stageDesktopAssistanceRuntimeFamilies } from './desktop-assistance-runtime-families.mjs';
import { stageDesktopAssistanceRuntimeHandoff } from './desktop-assistance-runtime-handoff.mjs';
import { stageDesktopAssistanceSpeechRuntime } from './desktop-assistance-speech-runtime.mjs';
import { stageDesktopKokoroG2pRuntime } from './desktop-kokoro-g2p-runtime.mjs';

export async function prepareDesktopAssistanceRuntimeSet({
	repositoryRoot, buildRoot, targetId, sourceRevision, handoffRoot,
}, {
	stageSpeech = stageDesktopAssistanceSpeechRuntime,
	stageFamilies = stageDesktopAssistanceRuntimeFamilies,
	buildKokoro = buildKokoroG2pBundle,
	stageKokoro = stageDesktopKokoroG2pRuntime,
	stageDistribution = stageDesktopAssistanceRuntimeDistribution,
	stageHandoff = stageDesktopAssistanceRuntimeHandoff,
	report = console.error,
} = {}) {
	const runtimeRoot = resolve(buildRoot, 'runtime');
	const archiveRoot = resolve(buildRoot, 'assistance-distribution');
	const cacheRoot = resolve(repositoryRoot, '.native-build/assistance-runtimes');
	if (handoffRoot) return stageHandoff({
		handoffRoot: resolve(handoffRoot), sourceRevision, targetId, archiveRoot,
		cacheRoot: resolve(repositoryRoot, '.native-build/assistance-runtime-handoff-cache'),
	});
	const assistanceSpeechRuntime = await phase('Sherpa ONNX', () => stageSpeech({
		repositoryRoot, targetId, nodeModulesRoot: resolve(repositoryRoot, 'node_modules'), runtimeRoot, cacheRoot,
	}));
	const assistanceRuntimeFamilies = await phase('ONNX, Whisper and llama', () => stageFamilies({ targetId, runtimeRoot, cacheRoot }));
	const kokoroBuild = await phase('Kokoro G2P build/cache verification', () => buildKokoro({
		targetId, outputRoot: resolve(cacheRoot, 'kokoro-g2p'), cacheRoot: resolve(cacheRoot, 'kokoro-g2p-cache'),
	}));
	const kokoroG2pRuntime = await phase('Kokoro G2P staging', () => stageKokoro({ targetId,
		bundleRoot: kokoroBuild.bundleRoot, runtimeRoot }));
	const distribution = await phase('Authenticate and archive all five runtimes', () => stageDistribution({
		targetId, runtimeRoot, archiveRoot, assistanceSpeechRuntime, assistanceRuntimeFamilies, kokoroG2pRuntime,
	}));
	return { speech: distribution.speech, families: distribution.families, kokoro: distribution.kokoro, distribution };

	async function phase(label, operation) {
		report(`[AI runtimes] ${label}: starting`);
		const started = performance.now();
		try { return await operation(); }
		finally { report(`[AI runtimes] ${label}: ${((performance.now() - started) / 1000).toFixed(1)} seconds`); }
	}
}

/** Keep the existing handoff/publisher format without building an application or renderer. */
export async function writeDesktopAssistanceRuntimeStage({ buildRoot, targetId, sourceRevision, prepared }) {
	assertIdentity(targetId, sourceRevision);
	const manifests = {
		'assistance-native-runtime-manifest.json': jsonBytes(prepared.speech.manifest),
		'assistance-runtime-family-supply-candidates.json': prepared.families.manifestBytes,
		'assistance-kokoro-g2p-runtime-manifest.json': prepared.kokoro.manifestBytes,
		'assistance-runtime-distribution.json': prepared.distribution.manifestBytes,
	};
	const configRoot = resolve(buildRoot, 'app/config');
	await mkdir(configRoot, { recursive: true });
	for (const [name, bytes] of Object.entries(manifests)) await writeFile(resolve(configRoot, name), bytes);
	const kokoroPath = 'config/assistance-kokoro-g2p-runtime-manifest.json';
	const kokoroBytes = manifests['assistance-kokoro-g2p-runtime-manifest.json'];
	const [platform, arch] = targetId.split('-');
	const stage = { schemaVersion: 1, sourceRevision, target: { platform, arch },
		assistanceNativeRuntime: prepared.speech.summary, assistanceNativeBuild: prepared.speech.buildReceipt,
		assistanceRuntimeFamilies: prepared.families.summary, assistanceRuntimeDistribution: prepared.distribution.summary,
		kokoroG2pRuntime: { ...prepared.kokoro.summary, manifest: { path: kokoroPath,
			byteLength: kokoroBytes.byteLength, sha256: createHash('sha256').update(kokoroBytes).digest('hex') } },
	};
	await writeFile(resolve(buildRoot, 'stage-manifest.json'), jsonBytes(stage));
	return stage;
}

export async function prepareDesktopAssistanceOnly({ repositoryRoot, targetId, sourceRevision }, {
	prepare = prepareDesktopAssistanceRuntimeSet,
} = {}) {
	// Validate before replacing even disposable output from a previous preparation.
	assertIdentity(targetId, sourceRevision);
	const buildRoot = resolve(repositoryRoot, '.desktop-build');
	await rm(buildRoot, { recursive: true, force: true });
	await mkdir(buildRoot, { recursive: true });
	const prepared = await prepare({ repositoryRoot, buildRoot, targetId, sourceRevision });
	return writeDesktopAssistanceRuntimeStage({ buildRoot, targetId, sourceRevision, prepared });
}

function assertIdentity(targetId, sourceRevision) {
	if (!/^(?:mac-arm64|(?:linux|win)-(?:x64|arm64))$/u.test(targetId ?? '')
		|| !/^[a-f\d]{40}(?:[a-f\d]{24})?$/u.test(sourceRevision ?? '')) {
		throw new TypeError('AI runtime preparation requires an exact target and source identity.');
	}
}

function jsonBytes(value) { return Buffer.from(`${JSON.stringify(value, null, 2)}\n`); }
