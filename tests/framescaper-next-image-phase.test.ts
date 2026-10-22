/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createClipboardDescriptor, preparePasteCommand } from '../src/common/editor/commands/clipboard-runtime.js';
import { normalizeAudioEditorClipboardDescriptor } from '../src/common/editor/commands/clipboard-codec.ts';
import { createProjectStore } from '../src/common/editor/storage.js';
import { normalizeFramescaperImageClipV1 } from '../src/common/editor/timeline-image-model.ts';
import { PROJECT_FEATURE_CAPABILITY_IDS } from '../src/common/editor/project-feature-capabilities.ts';
import { evaluateProjectFeatureRequirements } from '../src/common/editor/project-feature-requirements.ts';
import { editorProjectFeatureCapabilityProfileDefinition } from '../src/common/editor/project-feature-capability-profile.ts';
import { editorProjectRuntimeProfileDefinition } from '../src/common/editor/project-runtime-profile.ts';
import { createEditorProjectRuntimeSelection } from '../src/framescaper/editor-project-runtime-selection.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE as PROFILE } from '../src/framescaper/editor-project-runtime-profile.ts';
import { reconcileFramescaperProjectFeatureRequirementsAssistance } from '../src/framescaper/editor-project-feature-requirements-assistance.ts';
import {
	openFramescaperStoredImageFramePackTimelineImage,
	readFramescaperStoredImageFrameAtSampleTimelineImage,
} from '../src/framescaper/editor-selected-timeline-image-image-frame-source.ts';
import { createFramescaperBaselineImageFixture } from './helpers/framescaper-baseline-image-fixture.ts';
import { createFramescaperScapeNativeRuntime } from '../src/framescaper/editor-scape-native.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';

for (const rate of [{ num: 30, den: 1 }, { num: 30_000, den: 1_001 }]) test(`image Split preserves animated pictures at ${String(rate.num)}/${String(rate.den)} fps`, async () => {
	const { fixture, project, runtime } = phaseProject(rate);
	const history = runtime.executeCommand(runtime.createHistory(project), {
		type: 'clip/split', clipId: fixture.clip.id, atFrame: Math.round(48_000 * rate.den / rate.num), rightClipId: 'right-image',
	});
	const right = history.present.clips.find(clip => clip.id === 'right-image');
	assert.ok(right?.kind === 'image');
	const reader = await openFramescaperStoredImageFramePackTimelineImage({
		loadMediaAsset: () => Promise.resolve(new Blob([Uint8Array.from(fixture.bytes)])),
	}, fixture.source);
	for (const frame of [30, 60]) {
		const sample = Math.round(frame * 48_000 * rate.den / rate.num);
		const before = await readFramescaperStoredImageFrameAtSampleTimelineImage(
			reader, fixture.clip, sample, rate, 48_000,
		);
		const after = await readFramescaperStoredImageFrameAtSampleTimelineImage(
			reader, right, sample, rate, 48_000,
		);
		assert.deepEqual(after, before, 'splitting cannot change the exact source address or displayed RGBA frame');
	}
});

test('subsequent Split, left trim restoration and session clipboard retain the exact fractional phase', () => {
	const { project, runtime } = phaseProject();
	let history = runtime.executeCommand(runtime.createHistory(project), {
		type: 'clip/split', clipId: 'image-clip-1', atFrame: 1_600, rightClipId: 'right-image',
	});
	const right = history.present.clips.find(clip => clip.id === 'right-image');
	assert.ok(right?.kind === 'image');
	assert.deepEqual(right.sourceStartFraction, { num: '1', den: '3' });
	const descriptor = normalizeAudioEditorClipboardDescriptor(createClipboardDescriptor(
		runtime.projectForEditClipboardConsumers(history.present), {
			clipIds: [right.id], startFrame: 1_600, endFrame: 240_000,
		},
	));
	const clipboard = runtime.createEditSessionClipboard(history.present, descriptor);
	assert.deepEqual(clipboard.images.clips[0]?.sourceStartFraction, right.sourceStartFraction);
	const paste = preparePasteCommand(descriptor, { atFrame: 480_000, mode: 'overlap' }, prefix => `${prefix}-pasted`);
	const prepared = runtime.prepareEditClipboardPaste(history.present, clipboard, paste, prefix => `${prefix}-remapped`);
	const pasted = runtime.executeCommand(history, prepared.command).present.clips.find(clip => clip.id.endsWith('-pasted'));
	assert.ok(pasted?.kind === 'image');
	assert.deepEqual(pasted.sourceStartFraction, right.sourceStartFraction);
	history = runtime.executeCommand(history, { type: 'clip/split', clipId: right.id,
		atFrame: 48_000, rightClipId: 'integer-image' });
	const integer = history.present.clips.find(clip => clip.id === 'integer-image');
	assert.ok(integer?.kind === 'image');
	assert.equal(integer.sourceStartTicks, '1000000');
	assert.equal(Object.hasOwn(integer, 'sourceStartFraction'), false);
	const restored = runtime.executeCommand(history, { type: 'clip/trim', clipId: right.id, timelineStartFrame: 0 })
		.present.clips.find(clip => clip.id === right.id);
	assert.ok(restored?.kind === 'image');
	assert.equal(restored.sourceStartTicks, '0');
	assert.equal(Object.hasOwn(restored, 'sourceStartFraction'), false);
});

test('native archive roundtrip preserves phase and declares the required image precision capability', async context => {
	const { fixture, project, runtime } = phaseProject();
	const history = runtime.executeCommand(runtime.createHistory(project), { type: 'batch', commands: [
		{ type: 'clip/split', clipId: fixture.clip.id, atFrame: 1_600, rightClipId: 'right-image' },
		{ type: 'clip/remove', clipId: 'audio-clip' }, { type: 'track/remove', trackId: 'audio-track' },
		{ type: 'source/remove', sourceId: 'audio-source' },
	] });
	const store = createProjectStore({ indexedDB: createInstrumentedIndexedDB() as unknown as IDBFactory,
		preferOpfs: false, databaseName: 'image-exact-phase' });
	const recipient = createProjectStore({ indexedDB: createInstrumentedIndexedDB() as unknown as IDBFactory,
		preferOpfs: false, databaseName: 'image-exact-phase-recipient' });
	context.after(async () => { await store.close(); await recipient.close(); });
	await store.writeMediaAsset(fixture.source.storageKey, new Blob([Uint8Array.from(fixture.bytes)]), {
		kind: 'timeline-image', encoding: 'framescaper-image-asset-v1', mimeType: fixture.source.mimeType,
	});
	const archive = createFramescaperScapeNativeRuntime(PROFILE);
	const exported = await archive.exportScapeProject(history.present, store); assert.ok(exported.blob);
	const imported = await archive.importScapeProject(exported.blob, recipient);
	const reopened = imported.project; assert.ok(runtime.validateProject(reopened));
	assert.deepEqual(reopened.clips.find(clip => clip.id === 'right-image'),
		history.present.clips.find(clip => clip.id === 'right-image'));
	const requirement = reopened.featureRequirements.requirements.find(row => row.featureId === PROJECT_FEATURE_CAPABILITY_IDS.timelineImagePhase);
	assert.ok(requirement);
	const legacy = new Set(Object.values(PROJECT_FEATURE_CAPABILITY_IDS).filter(id => id !== PROJECT_FEATURE_CAPABILITY_IDS.timelineImagePhase));
	const compatibility = evaluateProjectFeatureRequirements(reopened.featureRequirements, {
		knownFeatureIds: legacy, availableFeatureIds: legacy, sources: reopened.sources,
	});
	assert.equal(compatibility.compatible, false);
	assert.equal(compatibility.items.find(row => row.requirementId === requirement.id)?.availability, 'unknown');
	assert.equal(runtime.compatibility.evaluate(reopened)?.compatible, true);
	const branded = editorProjectFeatureCapabilityProfileDefinition(editorProjectRuntimeProfileDefinition(PROFILE).capabilityProfile);
	assert.equal(branded.registrations.find(row => row.featureId === requirement.featureId)?.available, true);
});

test('legacy integer image clips keep their shape and fractional phase is closed, reduced and proper', () => {
	const { fixture } = phaseProject();
	assert.deepEqual(normalizeFramescaperImageClipV1(fixture.clip), fixture.clip);
	for (const fraction of [{ num: '0', den: '1' }, { num: '2', den: '4' },
		{ num: '3', den: '3' }, { num: '1', den: '0' }, { num: '01', den: '3' },
		{ num: '1', den: '3', extra: true }]) {
		assert.throws(() => normalizeFramescaperImageClipV1({ ...fixture.clip, sourceStartFraction: fraction }));
	}
});

function phaseProject(rate: Readonly<{ num: number; den: number }> = { num: 30, den: 1 }) {
	const fixture = createFramescaperBaselineImageFixture({ imageOnly: true });
	const candidate = { ...fixture.project,
		sequences: fixture.project.sequences.map(sequence => ({ ...sequence, rate })) };
	const project = { ...candidate,
		featureRequirements: reconcileFramescaperProjectFeatureRequirementsAssistance(PROFILE, candidate) };
	return { fixture, project, runtime: createEditorProjectRuntimeSelection(PROFILE) };
}
