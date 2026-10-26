/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createSoundscaperProject, validateSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createAup4ProjectTree } from '../src/common/editor/aup4-profile.js';
import { trackChannelCount } from '../src/common/editor/aup4-track-nodes.js';
import { audacityXmlChildren } from '../src/common/editor/audacity-binary-xml.js';
import { createAssistanceAssetReferenceV1, validateAssistanceAssetSourceBindingsV1, ASSISTANCE_TRANSCRIPT_BODY_MIME_TYPE_V1 } from '../src/common/editor/assistance/assistance-asset-reference-v1.ts';
import { createNativeProjectService } from '../src/common/editor/controller/document/native-project-service.ts';
import { createFixture } from './helpers/native-project-service-fixture.ts';

const DIGEST = 'ab'.repeat(32);
function projectFixture(count: number) {
	const project = createSoundscaperProject({ id: 'project-a',
		sources: Array.from({ length: count }, (_, index) => ({ id: `s${index}`, storageKey: `s${index}`,
			name: `Audio ${index}`, sampleRate: 48_000, channelCount: 1, frameCount: 64, contentSha256: DIGEST })),
		tracks: [{ id: 'track', clipIds: Array.from({ length: count }, (_, index) => `c${index}`) }],
		clips: Array.from({ length: count }, (_, index) => ({ id: `c${index}`, sourceId: `s${index}`,
			sourceStartFrame: 0, sourceDurationFrames: 64, durationFrames: 64, timelineStartFrame: index * 64 })),
	});
	assert.ok(validateSoundscaperProject(project));
	return project;
}

test('Audacity node building reuses clip and source identities through track width, rate, and channel construction', () => {
	const count = 300;
	const project = projectFixture(count);
	let clipReads = 0;
	let sourceReads = 0;
	const measured = { ...project,
		clips: project.clips.map(clip => ({ ...clip, get id() { clipReads++; return clip.id; } })),
		sources: project.sources.map(source => ({ ...source, get id() { sourceReads++; return source.id; } })),
	};
	assert.equal(trackChannelCount(measured, project.tracks[0]), 1);
	assert.ok(clipReads + sourceReads <= count * 3);
	clipReads = 0; sourceReads = 0;
	const tree = createAup4ProjectTree(measured);
	const tracks = audacityXmlChildren(tree).filter((node: { name: string }) => node.name === 'wavetrack');
	assert.equal(tracks.length, 1);
	assert.equal(audacityXmlChildren(tracks[0]).filter((node: { name: string }) => node.name === 'waveclip').length, count);
	assert.ok(clipReads + sourceReads <= count * 10, `received ${clipReads + sourceReads} media identity reads`);
});

test('assistance asset binding retains every digest and range check with one source identity pass', () => {
	const count = 1000;
	const project = projectFixture(count);
	const assets = Array.from({ length: count }, (_, index) => createAssistanceAssetReferenceV1({
		id: `asset${index}`, kind: 'transcript-v1', sourceId: `s${index}`, sourceSha256: DIGEST,
		sourceStartFrame: 0, sourceEndFrame: 64, sourceVideoTimingSha256: null,
		recipeId: 'speech-transcript', recipeVersion: 1, modelArtifactSha256s: ['12'.repeat(32)],
		body: { storageKey: `assistance-transcript-sha256:${DIGEST}`, mimeType: ASSISTANCE_TRANSCRIPT_BODY_MIME_TYPE_V1,
			byteLength: 512, sha256: DIGEST },
	}));
	let descriptorReads = 0;
	const measured = project.sources.map(source => new Proxy(source, {
		getOwnPropertyDescriptor(target, key) { if (key === 'id') descriptorReads++; return Reflect.getOwnPropertyDescriptor(target, key); },
	}));
	assert.equal(validateAssistanceAssetSourceBindingsV1(assets, measured), true);
	assert.ok(descriptorReads <= count * 2, `received ${descriptorReads} source ID descriptor reads`);
	assert.throws(() => validateAssistanceAssetSourceBindingsV1([{ ...assets[0]!, sourceSha256: 'cd'.repeat(32) }], measured), /digest does not match/u);
});

test('native Audacity saving collects referenced audio source IDs before storage preflight', async () => {
	const count = 1000;
	const project = projectFixture(count);
	let references = 0;
	let bytes = 0;
	const measured = { ...project, clips: project.clips.map(clip => ({ ...clip,
		get sourceId() { references++; return clip.sourceId; },
	})) };
	const quotaFailure = new Error('Storage quota declined');
	const fixture = createFixture({ getProject: () => measured,
		preflightStorage: async estimate => { bytes = estimate; throw quotaFailure; },
	});
	await assert.rejects(createNativeProjectService(fixture.runtime).saveAup4({ useFileSystemAccess: false }), error => error === quotaFailure);
	assert.equal(bytes, count * 64 * Float32Array.BYTES_PER_ELEMENT);
	assert.ok(references <= count * 5, `received ${references} clip source-reference reads`);
});
