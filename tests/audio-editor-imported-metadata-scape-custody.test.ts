/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test, { type TestContext } from 'node:test';

import { prepareImportedSourceProvenance } from '../src/common/editor/controller/import/internal/imported-source-provenance.ts';
import { createAudioClip, createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import type { SourceAttributionContributionV1 } from '../src/common/editor/source-provenance.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createSoundscaperProjectStore } from '../src/soundscaper/editor-project-store.ts';
import { createSoundscaperScapeNativeRuntime } from '../src/soundscaper/editor-scape-native.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';
import { footerTaggedMp3Fixture, multilingualMp3Fixture } from './helpers/ordinary-cover-mp3-fixture.ts';
import { quickTimeMetadataPrecedenceFixture } from './helpers/ordinary-tail-m4a-fixture.ts';

// The browser witness covers decoding and File-menu wiring. These cases exercise
// the real metadata reader, attribution, source admission, archive and reopen paths.
for (const legacy of [false, true]) {
	test(`Scape save and reopen retain MP3 footer metadata with legacy trailer=${String(legacy)}`, async context => {
		const contribution = await savedContribution(context, await footerTaggedMp3Fixture(legacy));
		assert.deepEqual(contribution.warnings, []);
		assert.equal(contribution.metadata.normalized.title, 'Footer title');
		assert.equal(contribution.metadata.normalized.artist, 'Footer performer');
		assert.equal(contribution.metadata.raw.TIT2, 'Footer title');
	});
}

for (const legacyFirst of [true, false]) {
	test(`Scape save and reopen retain modern QuickTime metadata with legacy first=${String(legacyFirst)}`, async context => {
		const contribution = await savedContribution(context, await quickTimeMetadataPrecedenceFixture(legacyFirst));
		assert.deepEqual(contribution.warnings, []);
		assert.equal(contribution.metadata.normalized.title, 'Two retained covers');
		assert.equal(contribution.metadata.normalized.album, 'Legacy album fallback');
		assert.equal(contribution.metadata.normalized.comment, 'After covers');
		assert.equal(contribution.metadata.raw['©nam'], 'Two retained covers');
		assert.equal(contribution.attachments.filter(({ path }) => /^images\[/u.test(path)).length, 2);
	});
}

test('Scape save and reopen retain every bilingual ID3 comment, lyric and identifier', async context => {
	const { file, payloads, records } = await multilingualMp3Fixture();
	const contribution = await savedContribution(context, file);
	assert.deepEqual(contribution.warnings, []);
	assert.equal(contribution.metadata.normalized.lyrics, 'First verse');
	assert.equal(contribution.metadata.normalized.comment, 'First comment');
	for (const [key, payload] of Object.entries(payloads)) {
		const path = `raw.${records[key] ? `${key}.bytes` : key}`;
		assert.deepEqual(contribution.metadata.raw[key], records[key] ?? { attachmentPath: path }, key);
		const attachment = contribution.attachments.find(candidate => candidate.path === path);
		assert.ok(attachment, path);
		assert.equal(attachment.sha256, createHash('sha256').update(payload).digest('hex'), key);
		assert.equal(attachment.byteLength, payload.length, key);
	}
});

async function savedContribution(context: TestContext, file: File): Promise<SourceAttributionContributionV1> {
	const provenance = await prepareImportedSourceProvenance(file, { createContributionId: () => 'import-credit' });
	const sender = createSoundscaperProjectStore({ indexedDB: createInstrumentedIndexedDB(), preferOpfs: false });
	const recipient = createSoundscaperProjectStore({ indexedDB: createInstrumentedIndexedDB(), preferOpfs: false });
	context.after(async () => { await sender.close(); await recipient.close(); });
	// A small PCM witness checks archive custody without pretending to decode the file.
	const samples = Float32Array.of(.25, -.5);
	const source = createAudioSource({ id: 'imported-source', name: file.name, mimeType: file.type,
		sampleRate: 48_000, channelCount: 1, frameCount: samples.length, provenance });
	const clip = createAudioClip({ id: 'clip', sourceId: source.id, durationFrames: samples.length });
	const project = createSoundscaperProject({ id: 'metadata-custody', sources: [source], clips: [clip],
		tracks: [createAudioTrack({ id: 'track', clipIds: [clip.id] })] });
	const writer = await sender.beginSourceWrite(source.id, source);
	await writer.write([samples]);
	await writer.commit({ sampleRate: source.sampleRate, channelCount: source.channelCount });
	const runtime = createSoundscaperScapeNativeRuntime();
	const exported = await runtime.exportScapeProject(project, sender);
	assert.ok(exported.blob);
	const reopened = await runtime.importScapeProject(exported.blob, recipient);
	assert.equal(reopened.readOnly, false);
	const savedSource = reopened.project.sources[0];
	assert.ok(savedSource?.provenance);
	assert.deepEqual(savedSource.provenance, provenance);
	const contribution = savedSource.provenance.contributions[0];
	assert.ok(contribution);
	assert.ok(contribution.origin.kind === 'local-file');
	assert.equal(contribution.origin.originalFileName, file.name);
	assert.equal(contribution.origin.byteLength, file.size);
	return contribution;
}
