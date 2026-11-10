/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test, { type TestContext } from 'node:test';
import { normalizeAssistanceAssetReferencesV1 } from '../src/common/editor/assistance/assistance-asset-reference-v1.ts';
import { createAssistanceTtsScriptBodyV1 } from '../src/common/editor/assistance/tts-script-body-publication-v1.ts';
import type { TextToSpeechReviewed } from '../src/common/editor/assistance/text-to-speech-port-contract.ts';
import { readClipLoop } from '../src/common/editor/audio-clip-loop.ts';
import { canonicalMediaContentBlob } from '../src/common/media/content-digest.ts';
import { resolveRuntimeProjectProjection } from '../src/common/editor/runtime-clip-projection.ts';
import { createSoundscaperScapeNativeRuntime } from '../src/soundscaper/editor-scape-native.ts';
import { createSoundscaperProjectStore } from '../src/soundscaper/editor-project-store.ts';
import type { SoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { assertPcmChannelsEqual } from './helpers/assert-pcm-samples.ts';
import { clipboardDocument, clipboardProject, createClipboardCustody } from './helpers/clipboard-source-custody.ts';
import { readCustodyPcm } from './helpers/audio-project-archive-pcm-custody.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';

type Custody = Awaited<ReturnType<typeof createClipboardCustody>>;

/** The original desktop bridge's authored response; this does not simulate model inference. */
function reviewedSpeech(text: string): Readonly<{ reviewed: TextToSpeechReviewed; pcm: Float32Array }> {
	const frames = 48_000, rate = 24_000, bytes = Buffer.alloc(44 + frames * 2), pcm = new Float32Array(frames);
	bytes.write('RIFF', 0); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVE', 8);
	bytes.write('fmt ', 12); bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22);
	bytes.writeUInt32LE(rate, 24); bytes.writeUInt32LE(rate * 2, 28); bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34);
	bytes.write('data', 36); bytes.writeUInt32LE(frames * 2, 40);
	for (let frame = 0; frame < frames; frame++) {
		const sample = Math.round(.2 * 32767 * Math.sin(2 * Math.PI * 220 * frame / rate));
		bytes.writeInt16LE(sample, 44 + frame * 2); pcm[frame] = sample === 0 ? 0 : sample / 32768;
	}
	return { pcm, reviewed: { audio: new Blob([bytes], { type: 'audio/wav' }),
		request: { text, language: 'a', voiceId: 'af_heart', speed: 1 },
		modelId: 'kokoro-82m', modelVersion: '1.0.0', artifactSha256s: ['a'.repeat(64)] } };
}

function onlyClip(value: unknown) {
	const clips = resolveRuntimeProjectProjection(clipboardProject(value)).clips;
	assert.equal(clips.length, 1); const clip = clips[0]; assert.ok(clip?.kind === 'audio'); return clip;
}

async function assertScript(store: Custody['store'], project: SoundscaperProject, reviewed: TextToSpeechReviewed): Promise<void> {
	const references = normalizeAssistanceAssetReferencesV1(project.assistanceAssets);
	assert.equal(references.length, 1); const reference = references[0]; assert.ok(reference?.kind === 'tts-script-v1');
	const clip = onlyClip(project), source = project.sources.find(value => value.id === clip.sourceId); assert.ok(source?.kind === 'audio');
	assert.equal(reference.sourceId, source.id); assert.equal(reference.sourceSha256, source.contentSha256);
	assert.equal(source.contentSha256, createHash('sha256').update(Buffer.from(await reviewed.audio.arrayBuffer())).digest('hex'));
	assert.deepEqual([reference.sourceStartFrame, reference.sourceEndFrame], [0, 48_000]);
	const stored = await store.loadMediaAsset(reference.body.storageKey); assert.ok(stored);
	const bytes = new Uint8Array(await canonicalMediaContentBlob(stored).arrayBuffer());
	assert.equal(bytes.length, reference.body.byteLength);
	assert.equal(createHash('sha256').update(bytes).digest('hex'), reference.body.sha256);
	const body = createAssistanceTtsScriptBodyV1(JSON.parse(new TextDecoder().decode(bytes)) as unknown);
	assert.deepEqual(body, { schemaVersion: 1, sourceId: source.id, ...reviewed.request,
		modelId: 'kokoro-82m', modelVersion: '1.0.0', artifactSha256s: ['a'.repeat(64)], recipe: { id: 'kokoro-text-to-speech', version: 1 } });
	assert.deepEqual(bytes, new TextEncoder().encode(JSON.stringify(body)), 'private script bytes remain canonical');
	assert.equal(JSON.stringify(project).includes(reviewed.request.text), false, 'the document carries a private script reference, not the script body');
}

/** Native Save includes the authenticated private script asset alongside its source PCM. */
async function assertSavedSpeech(context: TestContext, f: Custody, reviewed: TextToSpeechReviewed, pcm: Float32Array, reopenController = false): Promise<void> {
	await f.controller.actions.project.flush();
	const project = clipboardProject(f.controller.project), saved: unknown = await f.store.loadProject(project.id);
	assert.deepEqual(saved, project); await assertScript(f.store, project, reviewed);
	await f.controller.actions.timeline.selectClip(onlyClip(project).id);
	assert.deepEqual(await f.controller.textToSpeechProjectPort.loadInitial(), reviewed.request);
	for (const source of project.sources) {
		assert.ok(source.kind === 'audio'); assertPcmChannelsEqual(await readCustodyPcm(f.store, source), [pcm]);
	}
	const exported = await createSoundscaperScapeNativeRuntime().exportScapeProject(project, f.store); assert.ok(exported.blob);
	assert.equal(exported.manifest.assets.filter(asset => asset.kind === 'assistance-tts-script').length, 1);
	const recipient = createSoundscaperProjectStore({ indexedDB: createInstrumentedIndexedDB(), preferOpfs: false });
	context.after(async () => { await recipient.close(); });
	const imported = await createSoundscaperScapeNativeRuntime().importScapeProject(exported.blob, recipient);
	assert.equal(imported.readOnly, false);
	const reopened = clipboardProject(imported.project); assert.deepEqual(reopened, project);
	for (const source of reopened.sources) {
		assert.ok(source.kind === 'audio'); assertPcmChannelsEqual(await readCustodyPcm(recipient, source), [pcm]);
	}
	await assertScript(recipient, reopened, reviewed);
	if (reopenController) {
		// Close the donor after its final edit before a fresh controller acquires
		// the same project's real editing lease.
		await f.controller.dispose();
		const fresh = await createClipboardCustody(context);
		await fresh.controller.actions.project.openScapeFile(new File([exported.blob], 'Narration.sscape'), () => 'copy');
		assert.equal(fresh.controller.getSnapshot().readOnly, false);
		assert.deepEqual(clipboardDocument(clipboardProject(fresh.controller.project)), clipboardDocument(project));
		await assertScript(fresh.store, clipboardProject(fresh.controller.project), reviewed);
		await fresh.controller.actions.timeline.selectClip(onlyClip(project).id);
		assert.deepEqual(await fresh.controller.textToSpeechProjectPort.loadInitial(), reviewed.request);
	}
}

for (const mode of ['double speed', 'trimmed loop'] as const) test(`speech replacement retains ${mode} custody through its real controller, private script, history and fresh Scape`, async context => {
	const f = await createClipboardCustody(context), { controller } = f;
	const { reviewed, pcm } = reviewedSpeech(mode === 'double speed' ? 'Keep this narration at double speed.' : 'Replace the complete speech source.');
	assert.equal(await controller.textToSpeechProjectPort.loadInitial(), null);
	await controller.textToSpeechProjectPort.accept(reviewed);
	const original = clipboardProject(controller.project), clip = onlyClip(original), source = original.sources[0]; assert.ok(source?.kind === 'audio');
	assert.deepEqual([source.sampleRate, source.channelCount, source.frameCount], [24_000, 1, 48_000]);
	assert.deepEqual([clip.timelineStartFrame, clip.sourceStartFrame, clip.sourceDurationFrames, clip.durationFrames], [0, 0, 48_000, 96_000]);
	await controller.actions.timeline.selectClip(clip.id);
	if (mode === 'double speed') await controller.actions.clip.setTimePitch(clip.id, { speedRatio: 2 });
	else {
		await controller.actions.clip.trim(clip.id, { timelineStartFrame: 0, durationFrames: 24_000 });
		await controller.actions.clip.update(clip.id, { loop: { periodFrames: 24_000, durationFrames: 48_000 } });
		assert.deepEqual(readClipLoop(onlyClip(controller.project)), { periodFrames: 24_000, offsetFrames: 0 });
	}
	const before = clipboardProject(controller.project), prior = onlyClip(before), entries = controller.getSnapshot().history.undoEntries.length;
	assert.deepEqual([prior.speedRatio, prior.durationFrames], mode === 'double speed' ? [2, 48_000] : [1, 48_000]);
	await assertSavedSpeech(context, f, reviewed, pcm);
	await controller.textToSpeechProjectPort.accept(reviewed);
	const edited = clipboardProject(controller.project), replaced = onlyClip(edited), derived = edited.sources.find(value => value.id === replaced.sourceId); assert.ok(derived?.kind === 'audio');
	assert.equal(controller.getSnapshot().history.undoEntries.length, entries + 1);
	assert.equal(replaced.id, clip.id); assert.notEqual(derived.id, source.id);
	assert.deepEqual([derived.sampleRate, derived.channelCount, derived.frameCount], [24_000, 1, 48_000]);
	assert.deepEqual([replaced.timelineStartFrame, replaced.sourceStartFrame, replaced.sourceDurationFrames, replaced.durationFrames, replaced.speedRatio],
		[0, 0, 48_000, mode === 'double speed' ? 48_000 : 96_000, mode === 'double speed' ? 2 : 1]);
	assert.equal(readClipLoop(replaced), null); assert.equal(replaced.warpMap, null);
	assert.deepEqual([replaced.trimStartFrames, replaced.trimEndFrames], [0, 0]);
	await assertSavedSpeech(context, f, reviewed, pcm);
	await controller.actions.edit.undo(); assert.deepEqual(clipboardDocument(clipboardProject(controller.project)), clipboardDocument(before));
	await assertSavedSpeech(context, f, reviewed, pcm);
	await controller.actions.edit.redo(); assert.deepEqual(clipboardDocument(clipboardProject(controller.project)), clipboardDocument(edited));
	await assertSavedSpeech(context, f, reviewed, pcm, true);
});
