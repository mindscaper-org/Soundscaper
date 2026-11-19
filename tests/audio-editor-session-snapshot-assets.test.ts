/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { digestBytes } from '../src/common/media/bytes.ts';
import { createAssistanceTranscriptBodyPublicationV1 } from '../src/common/editor/assistance/transcript-body-publication-v1.ts';
import { canonicalMediaContentBlob } from '../src/common/media/content-digest.ts';
import { readSessionSnapshots, snapshotProjectState } from '../src/common/editor/session-snapshots.ts';
import { applySoundscaperProjectCommand } from '../src/soundscaper/editor-project-commands.ts';
import { createSoundscaperProject, validateSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createSoundscaperEphemeralProjectStore } from '../src/soundscaper/editor-project-store.ts';
import { createSoundscaperNativePluginStateScapeExtension } from '../src/soundscaper/editor-native-plugin-state-scape.ts';
import { createSoundscaperScapeNativeRuntime, type SoundscaperScapeNativeStore } from '../src/soundscaper/editor-scape-native.ts';

const NOW = '2026-11-16T12:00:00.000Z';

test('native plug-in archive inventory admits the project structure once per direction', async context => {
	const store = createSoundscaperEphemeralProjectStore();
	context.after(async () => { await store.close(); });
	const project = createSoundscaperProject({ now: NOW });
	const archive = await createSoundscaperScapeNativeRuntime().exportScapeProject(project, store);
	const extension = createSoundscaperNativePluginStateScapeExtension();
	let inspections = 0;
	const observed = new Proxy(project, { ownKeys(value) {
		inspections += 1;
		return Reflect.ownKeys(value);
	} });
	assert.ok(validateSoundscaperProject(observed));
	const singleAdmission = inspections;
	assert.ok(singleAdmission > 0);
	inspections = 0;
	assert.deepEqual(await extension.planExportAssets({ project: observed, store }), []);
	assert.equal(inspections, singleAdmission, 'export scans the same project structure once');
	inspections = 0;
	extension.validateImportAssets(observed, archive.manifest);
	assert.equal(inspections, singleAdmission, 'import scans the same project structure once');
});

test('snapshot-only native plug-in bodies travel with the project and are deduplicated', async context => {
	const bytes = Uint8Array.from([1, 7, 255]);
	const sha256 = digestBytes(bytes), bodyId = `native-plugin-state:${sha256}`;
	const sender = createSoundscaperEphemeralProjectStore(), recipient = createSoundscaperEphemeralProjectStore();
	context.after(async () => { await sender.close(); await recipient.close(); });
	const received = new Map<string, Uint8Array>();
	const senderPort: SoundscaperScapeNativeStore = {
		getNativePluginStateBodyMetadata: id => id === bodyId ? { sha256, byteLength: bytes.byteLength } : null,
		loadNativePluginStateBody: id => id === bodyId ? bytes : null,
	};
	const recipientPort: SoundscaperScapeNativeStore = {
		persistNativePluginStateBody: (value, expected) => { received.set(expected.bodyId, value); return expected; },
	};
	let project = createSoundscaperProject({ nativePluginStates: [{
		instanceId: 'plugin', format: 'vst3', stablePluginId: 'test.plugin', binarySha256: 'ab'.repeat(32),
		stateBody: { kind: 'native-plugin-state', bodyId, sha256, byteLength: bytes.byteLength },
		enabled: true, bypassed: false, continuity: 'live', latencySamples: 0,
	}] });
	project = applySoundscaperProjectCommand(project, { type: 'project/snapshot-create', id: 'one', name: 'One', createdAt: NOW });
	project = applySoundscaperProjectCommand(project, { type: 'project/snapshot-create', id: 'two', name: 'Two', createdAt: NOW });
	project = applySoundscaperProjectCommand(project, { type: 'native-plugin-state/remove', instanceId: 'plugin' });
	assert.equal(project.nativePluginStates.length, 0);
	const runtime = createSoundscaperScapeNativeRuntime();
	const archive = await runtime.exportScapeProject(project, extendStore(sender, senderPort));
	assert.equal(archive.manifest.assets.filter(asset => asset.kind === 'native-plugin-state').length, 1);
	assert.ok(archive.blob instanceof Blob);
	const imported = await runtime.importScapeProject(archive.blob, extendStore(recipient, recipientPort));
	assert.deepEqual(received.get(bodyId), bytes);
	const restored = applySoundscaperProjectCommand(imported.project, { type: 'project/snapshot-restore', id: 'one' });
	assert.equal(restored.nativePluginStates[0]!.stateBody.bodyId, bodyId);
});

test('snapshot-only transcript bodies survive cleanup and collision import with their source', async context => {
	const sender = createSoundscaperEphemeralProjectStore(), recipient = createSoundscaperEphemeralProjectStore();
	context.after(async () => { await sender.close(); await recipient.close(); });
	const sourceSha256 = 'ab'.repeat(32);
	const transcript = createAssistanceTranscriptBodyPublicationV1({ assetId: 'transcript',
		review: { kind: 'transcript', language: 'en', segments: [{ startSeconds: 0, endSeconds: 4 / 48000,
			text: 'Hello', speaker: null, words: [] }] },
		selectedMedia: { selectionFence: { schemaFamily: 'soundscaper', schemaVersion: 1,
			projectId: 'project', revision: 0, sequenceId: 'sequence', occurrenceIds: ['clip'],
			sourceId: 'source', sourceSha256, sourceStartFrame: 0, sourceEndFrame: 4,
			linkMembershipSha256: '11'.repeat(32), timingAuthoritySha256: '22'.repeat(32) },
			sampleRate: 48000, sourceVideoTimingSha256: null },
		model: { modelId: 'test', artifactSha256s: ['cd'.repeat(32)] }, recipe: { id: 'transcript', version: 1 },
	});
	for (const store of [sender, recipient]) {
		const writer = await store.beginSourceWrite('source', { sampleRate: 48000, channelCount: 1 });
		await writer.write([Float32Array.of(0.125, -0.25, 0.5, -0.75)]); await writer.commit();
	}
	await sender.writeMediaAsset(transcript.reference.body.storageKey, new Blob([transcript.bytes]), {
		mimeType: transcript.reference.body.mimeType, contentSha256: transcript.reference.body.sha256,
		kind: 'assistance-transcript', encoding: 'canonical-json-v1',
	});
	let project = createSoundscaperProject({ sources: [{ id: 'source', kind: 'audio', name: 'Voice',
		storageKey: 'source', sampleRate: 48000, frameCount: 4, channelCount: 1, contentSha256: sourceSha256 }],
		assistanceAssets: [transcript.reference] });
	project = applySoundscaperProjectCommand(project, { type: 'project/snapshot-create', id: 'one', name: 'Transcript', createdAt: NOW });
	const current = structuredClone(project) as Record<string, unknown>; current.assistanceAssets = [];
	current.featureRequirements = createSoundscaperProject().featureRequirements;
	assert.ok(validateSoundscaperProject(current));
	project = current;
	await sender.saveProject(project); await sender.pruneUnreferencedSources({ minimumAgeMs: 0 });
	assert.ok(await sender.getMediaAssetMetadata(transcript.reference.body.storageKey));
	const runtime = createSoundscaperScapeNativeRuntime();
	const archive = await runtime.exportScapeProject(project, sender);
	assert.equal(archive.manifest.assets.filter(asset => asset.kind === 'assistance-transcript').length, 1);
	assert.ok(archive.blob instanceof Blob);
	const imported = await runtime.importScapeProject(archive.blob, recipient);
	const restored = snapshotProjectState(imported.project, readSessionSnapshots(imported.project)[0]!);
	const assets = restored.assistanceAssets as readonly (typeof transcript.reference)[];
	assert.notEqual(assets[0]!.sourceId, 'source');
	const loaded = await recipient.loadMediaAsset(assets[0]!.body.storageKey);
	const content = await canonicalMediaContentBlob(loaded);
	const body = JSON.parse(await content.text()) as { sourceId: string };
	assert.equal(body.sourceId, assets[0]!.sourceId);
});

function extendStore(store: ReturnType<typeof createSoundscaperEphemeralProjectStore>, port: SoundscaperScapeNativeStore) {
	return new Proxy(store as typeof store & SoundscaperScapeNativeStore, { get(target, key) {
		const owner = Object.hasOwn(port, key) ? port : target;
		const value: unknown = Reflect.get(owner, key, owner);
		return typeof value === 'function' ? value.bind(owner) : value;
	} });
}
