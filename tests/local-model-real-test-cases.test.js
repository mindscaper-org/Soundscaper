/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';

import { validateLocalModelRealTestCases } from '../scripts/lib/local-model-real-test-cases.mjs';
import { generateLocalModelTestDocuments, localModelRuntimeAvailability } from '../scripts/lib/local-model-test-docs.mjs';
import { WHISPER_RUNTIME_BUILD_TARGETS, WHISPER_RUNTIME_VERSION } from '../scripts/lib/desktop-assistance-whisper-runtime.mjs';
import { LLAMA_RUNTIME_BUILD_TARGETS, LLAMA_RUNTIME_VERSION } from '../scripts/lib/desktop-assistance-llama-runtime.mjs';

const root = resolve(import.meta.dirname, '..');
const catalog = JSON.parse(await readFile(resolve(root, 'config/local-model-catalog.json'), 'utf8'));
const manifest = JSON.parse(await readFile(resolve(root, 'config/local-model-real-test-cases.json'), 'utf8'));
const candidateTasks = JSON.parse(await readFile(resolve(root, 'config/milestone-7-model-catalog-tasks.json'), 'utf8')).tasks;
const options = { candidateTasks };
const nativeRuntime = JSON.parse(await readFile(resolve(root, 'config/assistance-native-runtime-manifest.json'), 'utf8'));
const onnxRuntime = JSON.parse(await readFile(resolve(root, 'config/assistance-onnx-runtime-payloads.json'), 'utf8'));
const sherpaArm64Build = JSON.parse(await readFile(resolve(root, 'config/assistance-sherpa-win-arm64-build.json'), 'utf8'));
const kokoroG2pBuild = JSON.parse(await readFile(resolve(root, 'config/assistance-kokoro-g2p-build-candidate.json'), 'utf8'));
const kokoroG2pReady = kokoroG2pBuild.status === 'package-generated';
const runtimeSources = { nativeRuntime, onnxRuntime, sherpaArm64Build, kokoroG2pBuild,
	whisperBuild: { version: WHISPER_RUNTIME_VERSION, targets: WHISPER_RUNTIME_BUILD_TARGETS },
	llamaBuild: { version: LLAMA_RUNTIME_VERSION, targets: LLAMA_RUNTIME_BUILD_TARGETS } };
test('real model cases cover every published and explicitly required candidate model', () => {
	const cases = validateLocalModelRealTestCases(manifest, catalog, options);
	const speech = cases.find(({ operation }) => operation === 'text-to-speech');
	assert.ok(speech);
	assert.deepEqual({
		fixtureId: speech.fixtureId,
		validation: speech.validation,
		modelIds: speech.modelIds,
	}, { fixtureId: 'tts-script', validation: 'synthesized-audio', modelIds: ['kokoro-82m-v1.0'] });
	assert.deepEqual(cases.find(({ operation }) => operation === 'speaker-diarization').modelIds,
		['pyannote-segmentation-3.0', 'speech-3d-speaker-eres2net']);
	assert.deepEqual(cases.find(({ operation }) => operation === 'subject-detection').modelIds,
		['yunet-face-detection-2026may', 'dfine-nano-coco']);
	assert.equal(cases.find(({ operation }) => operation === 'image-text-embedding').fixtureId,
		'visual-subject-frames');
});

test('adding a published model without a real execution case fails coverage', () => {
	const added = structuredClone(catalog);
	added.entries.push({ ...added.entries[0], modelId: 'new-vad' });
	assert.throws(() => validateLocalModelRealTestCases(manifest, added, options), /new-vad.*case/u);
});

test('real model cases reject duplicates, foreign models, and a mismatched fixture or output', () => {
	for (const [edit, expected] of [
		[(value) => value.cases.push(value.cases[0]), /duplicate/u],
		[(value) => { value.cases[0].modelIds = ['unknown-model']; }, /unknown-model/u],
		[(value) => { value.cases[0].fixtureId = 'transcript-text'; }, /fixture/u],
		[(value) => { value.cases[0].validation = 'changed-audio'; }, /validation/u],
		[(value) => { value.cases[0].operation = 'source-separation'; }, /operation/u],
		[(value) => { value.cases[0].documentation.modelTitles = {}; }, /title/u],
	]) {
		const changed = structuredClone(manifest);
		edit(changed);
		assert.throws(() => validateLocalModelRealTestCases(changed, catalog, options), expected);
	}
});

test('every model handbook page stays derived from its real test and catalog', async () => {
	const result = await generateLocalModelTestDocuments(root, { write: false });
	assert.equal(result.documentCount, new Set([
		...catalog.entries.map(({ modelId }) => modelId),
		...candidateTasks.map(({ catalogModelId }) => catalogModelId),
	]).size + 1);
	assert.deepEqual(result.stale, []);
});

test('model guides state their purpose and collapse implementation test detail by default', async () => {
	const cases = validateLocalModelRealTestCases(manifest, catalog, options);
	for (const entry of catalog.entries) {
		const documentation = cases.find(({ modelIds }) => modelIds.includes(entry.modelId)).documentation;
		const page = await readFile(resolve(root,
			`handbook/src/content/docs/reference/local-models/${entry.modelId}.md`), 'utf8');
		const purposeHeading = page.indexOf('{#purpose-and-use-case}');
		assert.notEqual(purposeHeading, -1);
		assert.ok(page.indexOf(documentation.summary, purposeHeading) > purposeHeading);
		assert.match(page, /<details id="what-the-packaged-test-checks">\n<summary>[^<]+<\/summary>/u);
		assert.doesNotMatch(page, /<details[^>]*\bopen\b/u);
	}
});

test('every published model has Linux runtime support and documents Windows dependencies', async () => {
	const availability = catalog.entries.map((entry) => ({ entry,
		...localModelRuntimeAvailability(entry, runtimeSources) }));
	for (const { entry, availablePlatforms, familyId } of availability) {
		if (entry.modelId === 'kokoro-82m-v1.0' && !kokoroG2pReady) continue;
		assert.ok(availablePlatforms.includes('linux-x64'), `${entry.modelId} must be usable on Linux x64.`);
		const page = await readFile(resolve(root,
			`handbook/src/content/docs/reference/local-models/${entry.modelId}.md`), 'utf8');
		if (['onnxruntime-node', 'sherpa-onnx-node'].includes(familyId)) {
			assert.match(page, /learn\.microsoft\.com\/en-us\/cpp\/windows\/latest-supported-vc-redist/u);
		}
	}
	const silero = availability.find(({ entry }) => entry.modelId === 'silero-vad-v6');
	assert.deepEqual(silero.availablePlatforms.toSorted(),
		['darwin-arm64', 'linux-arm64', 'linux-x64', 'win32-arm64', 'win32-x64']);
	assert.ok(silero.missingPlatforms.includes('darwin-x64'));
});

test('every real model case is admitted on all five supported desktop targets', () => {
	const entries = new Map(catalog.entries.map((entry) => [entry.modelId, entry]));
	for (const { id, modelIds } of manifest.cases) for (const modelId of modelIds) {
		const entry = entries.get(modelId);
		if (!entry) continue;
		const availability = localModelRuntimeAvailability(entry, runtimeSources);
		for (const platform of ['darwin-arm64', 'linux-arm64', 'linux-x64', 'win32-arm64', 'win32-x64']) {
			assert.ok(entry.platforms.includes(platform), `${id}: ${modelId} must not be skipped on ${platform}.`);
			if (modelId === 'kokoro-82m-v1.0' && !kokoroG2pReady) {
				assert.ok(availability.missingPlatforms.includes(platform), `${id}: offline G2P must fail closed on ${platform}.`);
				continue;
			}
			assert.ok(availability.availablePlatforms.includes(platform), `${id}: ${modelId} must have native packaging support on ${platform}.`);
		}
	}
});

test('Kokoro runtime availability follows the verified offline G2P build status', () => {
	const entry = catalog.entries.find(({ modelId }) => modelId === 'kokoro-82m-v1.0');
	assert.ok(entry);
	const availability = localModelRuntimeAvailability(entry, runtimeSources);
	if (kokoroG2pReady) {
		assert.equal(availability.blockedBy, undefined);
		assert.deepEqual(availability.availablePlatforms.toSorted(), entry.platforms.toSorted());
		assert.deepEqual(availability.missingPlatforms, []);
	} else {
		assert.equal(availability.blockedBy, 'kokoro-offline-g2p-unprovisioned');
		assert.deepEqual(availability.availablePlatforms, []);
		assert.deepEqual(availability.missingPlatforms, entry.platforms);
	}
});

test('Kokoro runtime support requires its package-generated offline G2P target recipe', () => {
	const entry = catalog.entries.find(({ modelId }) => modelId === 'kokoro-82m-v1.0');
	assert.ok(entry);
	const provisioned = { ...kokoroG2pBuild, status: 'package-generated' };
	const ready = localModelRuntimeAvailability(entry, { ...runtimeSources, kokoroG2pBuild: provisioned });
	assert.deepEqual(ready.availablePlatforms.toSorted(), entry.platforms.toSorted());
	assert.deepEqual(ready.missingPlatforms, []);
	assert.equal(ready.blockedBy, undefined);
	const linuxOnly = localModelRuntimeAvailability(entry, { ...runtimeSources,
		kokoroG2pBuild: { ...provisioned, targetIds: ['linux-x64'] } });
	assert.deepEqual(linuxOnly.availablePlatforms, ['linux-x64']);
	assert.ok(linuxOnly.missingPlatforms.includes('win32-arm64'));
	const missingTargets = localModelRuntimeAvailability(entry, { ...runtimeSources,
		kokoroG2pBuild: { ...provisioned, targetIds: [] } });
	assert.equal(missingTargets.blockedBy, 'kokoro-offline-g2p-unprovisioned');
	const foreignTargets = localModelRuntimeAvailability(entry, { ...runtimeSources,
		kokoroG2pBuild: { ...provisioned, targetIds: ['foreign-target'] } });
	assert.equal(foreignTargets.blockedBy, 'kokoro-offline-g2p-unprovisioned');
});

test('published former candidates retain required test coverage and exact task metadata', () => {
	assert.doesNotThrow(() => validateLocalModelRealTestCases(manifest, catalog));
	const missing = { ...manifest, cases: manifest.cases.filter(({ modelIds }) => !modelIds.includes('qwen3-4b-q4-k-m')) };
	assert.throws(() => validateLocalModelRealTestCases(missing, catalog), /qwen3.*no real execution case/u);
	const duplicate = [...candidateTasks, candidateTasks[0]];
	assert.throws(() => validateLocalModelRealTestCases(manifest, catalog, { candidateTasks: duplicate }), /duplicate candidate/u);
	const conflict = { ...candidateTasks[0], catalogModelId: catalog.entries[0].modelId };
	assert.throws(() => validateLocalModelRealTestCases(manifest, catalog, { candidateTasks: [conflict] }), /conflicting task/u);
	assert.equal(catalog.entries.some(({ modelId }) => modelId === 'qwen3-4b-q4-k-m'), true);
});

test('published model guides retain pinned engine and license provenance', async () => {
	const [qwen, dereverb] = await Promise.all([
		readFile(resolve(root, 'handbook/src/content/docs/reference/local-models/qwen3-4b-q4-k-m.md'), 'utf8'),
		readFile(resolve(root, 'handbook/src/content/docs/reference/local-models/dereverb-room.md'), 'utf8'),
	]);
	assert.match(qwen, /llama-cpp b10509/u);
	assert.match(dereverb, /GPL-3.0/u);
});

test('Windows ARM64 catalog admission requires its package-generated native runtime', () => {
	const silero = catalog.entries.find(({ modelId }) => modelId === 'silero-vad-v6');
	assert.ok(silero.platforms.includes('win32-arm64'));
	assert.ok(localModelRuntimeAvailability(silero, runtimeSources).availablePlatforms.includes('win32-arm64'));
	assert.ok(localModelRuntimeAvailability(silero,
		{ ...runtimeSources, sherpaArm64Build: undefined }).missingPlatforms.includes('win32-arm64'));
});

test('native availability follows packaged file inventories and build recipes', () => {
	const changed = structuredClone(onnxRuntime);
	delete changed.sources.find(({ id }) => id === 'onnxruntime-node').targetFiles['linux-x64'];
	const entry = catalog.entries.find(({ modelId }) => modelId === 'deepfilternet3');
	assert.ok(localModelRuntimeAvailability(entry, runtimeSources).availablePlatforms.includes('linux-x64'));
	assert.ok(localModelRuntimeAvailability(entry,
		{ ...runtimeSources, onnxRuntime: changed }).missingPlatforms.includes('linux-x64'));
	const whisper = catalog.entries.find(({ modelId }) => modelId.startsWith('whisper-'));
	assert.ok(localModelRuntimeAvailability(whisper, runtimeSources).availablePlatforms.includes('linux-x64'));
	assert.deepEqual(localModelRuntimeAvailability(whisper,
		{ ...runtimeSources, whisperBuild: { version: WHISPER_RUNTIME_VERSION, targets: [] } }).availablePlatforms, []);
});
