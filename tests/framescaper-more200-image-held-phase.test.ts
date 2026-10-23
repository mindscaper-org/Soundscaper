/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createEditorProjectRuntimeSelection } from '../src/framescaper/editor-project-runtime-selection.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE as PROFILE } from '../src/framescaper/editor-project-runtime-profile.ts';
import { reconcileFramescaperProjectFeatureRequirementsAssistance } from '../src/framescaper/editor-project-feature-requirements-assistance.ts';
import { createFramescaperBaselineImageFixture } from './helpers/framescaper-baseline-image-fixture.ts';

import { createClipboardDescriptor, preparePasteCommand } from '../src/common/editor/commands/clipboard-runtime.js';
import { normalizeAudioEditorClipboardDescriptor } from '../src/common/editor/commands/clipboard-codec.ts';
import { createProjectStore } from '../src/common/editor/storage.js';
import { createFramescaperScapeNativeRuntime } from '../src/framescaper/editor-scape-native.ts';
import { createInstrumentedIndexedDB } from './helpers/instrumented-indexeddb.js';
import { PROJECT_FEATURE_CAPABILITY_IDS } from '../src/common/editor/project-feature-capabilities.ts';
import { evaluateProjectFeatureRequirements } from '../src/common/editor/project-feature-requirements.ts';
import { openFramescaperStoredImageFramePackTimelineImage, readFramescaperStoredImageFrameAtSampleTimelineImage }
	from '../src/framescaper/editor-selected-timeline-image-image-frame-source.ts';

const HOLD_PHASE = 'org.soundscaper.capability.timeline-image-hold-phase-v1';

function setup(rate = { num: 30, den: 1 }) {
	const fixture = createFramescaperBaselineImageFixture({ imageOnly: true });
	const candidate = { ...fixture.project, sequences: fixture.project.sequences.map(sequence => ({
		...sequence, rate,
	})) };
	const project = { ...candidate, featureRequirements:
		reconcileFramescaperProjectFeatureRequirementsAssistance(PROFILE, candidate) };
	const runtime = createEditorProjectRuntimeSelection(PROFILE);
	const extended = runtime.executeCommand(runtime.createHistory(project), {
		type: 'clip/trim', clipId: fixture.clip.id, durationFrames: 384_000,
	});
	return { fixture, runtime, extended };
}

test('an image trimmed into its held final frame can restore its complete original head', () => {
	const { fixture, runtime, extended } = setup();
	const trimmed = runtime.executeCommand(extended, {
		type: 'clip/trim', clipId: fixture.clip.id, timelineStartFrame: 288_000,
	});
	const restored = runtime.executeCommand(trimmed, {
		type: 'clip/trim', clipId: fixture.clip.id, timelineStartFrame: 0,
	});
	assert.deepEqual(restored.present.clips.find(clip => clip.id === fixture.clip.id), {
		...fixture.clip, sequenceFrameCount: 240,
	});
	assert.deepEqual(runtime.undo(restored).present.clips, trimmed.present.clips);
	assert.deepEqual(runtime.redo(runtime.undo(restored)).present.clips, restored.present.clips);
});

test('a split inside an image held tail keeps its actual elapsed source phase', () => {
	const { fixture, runtime, extended } = setup();
	const split = runtime.executeCommand(extended, {
		type: 'clip/split', clipId: fixture.clip.id, atFrame: 288_000, rightClipId: 'held-tail',
	});
	const right = split.present.clips.find(clip => clip.id === 'held-tail');
	assert.ok(right?.kind === 'image');
	assert.equal(right.sourceStartTicks, '6000000');
	const restored = runtime.executeCommand(split, {
		type: 'clip/trim', clipId: right.id, timelineStartFrame: 0,
	});
	const clip = restored.present.clips.find(item => item.id === right.id);
	assert.ok(clip?.kind === 'image');
	assert.equal(clip.sequenceStartFrame, 0);
	assert.equal(clip.sequenceFrameCount, 240);
	assert.equal(clip.sourceStartTicks, '0');
});

test('held phase survives clipboard and native file roundtrip with a precise capability fence', async context => {
	const { fixture, runtime, extended } = setup();
	let trimmed = runtime.executeCommand(extended, { type: 'clip/trim', clipId: fixture.clip.id,
		timelineStartFrame: 288_000 });
	trimmed = runtime.executeCommand(trimmed, { type: 'batch', commands: [
		{ type: 'clip/remove', clipId: 'audio-clip' }, { type: 'track/remove', trackId: 'audio-track' },
		{ type: 'source/remove', sourceId: 'audio-source' },
	] });
	const descriptor = normalizeAudioEditorClipboardDescriptor(createClipboardDescriptor(
		runtime.projectForEditClipboardConsumers(trimmed.present), {
			clipIds: [fixture.clip.id], startFrame: 288_000, endFrame: 384_000,
		},
	));
	const clipboard = runtime.createEditSessionClipboard(trimmed.present, descriptor);
	assert.equal(clipboard.images.clips[0]?.sourceStartTicks, '6000000');
	const paste = preparePasteCommand(descriptor, { atFrame: 480_000, mode: 'overlap' }, prefix => `${prefix}-pasted`);
	const prepared = runtime.prepareEditClipboardPaste(trimmed.present, clipboard, paste, prefix => `${prefix}-remapped`);
	const pasted = runtime.executeCommand(trimmed, prepared.command).present.clips.find(clip => clip.id.endsWith('-pasted'));
	assert.ok(pasted?.kind === 'image'); assert.equal(pasted.sourceStartTicks, '6000000');
	const store = createProjectStore({ indexedDB: createInstrumentedIndexedDB() as unknown as IDBFactory,
		preferOpfs: false, databaseName: 'held-phase-origin' });
	const recipient = createProjectStore({ indexedDB: createInstrumentedIndexedDB() as unknown as IDBFactory,
		preferOpfs: false, databaseName: 'held-phase-recipient' });
	context.after(async () => { await store.close(); await recipient.close(); });
	await store.writeMediaAsset(fixture.source.storageKey, new Blob([Uint8Array.from(fixture.bytes)]), {
		kind: 'timeline-image', encoding: 'framescaper-image-asset-v1', mimeType: fixture.source.mimeType,
	});
	const archive = createFramescaperScapeNativeRuntime(PROFILE);
	const exported = await archive.exportScapeProject(trimmed.present, store); assert.ok(exported.blob);
	const reopened = (await archive.importScapeProject(exported.blob, recipient)).project;
	assert.ok(runtime.validateProject(reopened)); assert.deepEqual(reopened.clips, trimmed.present.clips);
	const held = reopened.clips.find(clip => clip.id === fixture.clip.id); assert.ok(held?.kind === 'image');
	const original = extended.present.clips.find(clip => clip.id === fixture.clip.id); assert.ok(original?.kind === 'image');
	const reader = await openFramescaperStoredImageFramePackTimelineImage({
		loadMediaAsset: () => Promise.resolve(new Blob([Uint8Array.from(fixture.bytes)])),
	}, fixture.source);
	assert.deepEqual(await readFramescaperStoredImageFrameAtSampleTimelineImage(reader, held, 288_000, { num: 30, den: 1 }, 48_000),
		await readFramescaperStoredImageFrameAtSampleTimelineImage(reader, original, 288_000, { num: 30, den: 1 }, 48_000));
	const requirement = reopened.featureRequirements.requirements.find(row => row.featureId === HOLD_PHASE);
	assert.ok(requirement);
	const legacy = new Set(Object.values(PROJECT_FEATURE_CAPABILITY_IDS).filter(id => id !== HOLD_PHASE));
	const compatibility = evaluateProjectFeatureRequirements(reopened.featureRequirements, {
		knownFeatureIds: legacy, availableFeatureIds: legacy, sources: reopened.sources,
	});
	assert.equal(compatibility.compatible, false);
	assert.equal(compatibility.items.find(row => row.requirementId === requirement.id)?.availability, 'unknown');
	assert.equal(runtime.compatibility.evaluate(reopened)?.compatible, true);
	const restored = runtime.executeCommand(runtime.createHistory(reopened), {
		type: 'clip/trim', clipId: fixture.clip.id, timelineStartFrame: 0,
	}).present;
	assert.equal(restored.featureRequirements.requirements.some(row => row.featureId === HOLD_PHASE), false);
	const clip = restored.clips.find(item => item.id === fixture.clip.id); assert.ok(clip?.kind === 'image');
	assert.equal(clip.sequenceStartFrame, 0); assert.equal(clip.sourceStartTicks, '0');
});

test('a long held image keeps bounded elapsed phase without extending its source asset duration', () => {
	const { fixture, runtime, extended } = setup({ num: 1, den: 1 });
	const long = runtime.executeCommand(extended, { type: 'clip/trim', clipId: fixture.clip.id,
		durationFrames: 26 * 3_600 * 48_000 });
	const held = runtime.executeCommand(long, { type: 'clip/trim', clipId: fixture.clip.id,
		timelineStartFrame: 25 * 3_600 * 48_000 });
	const clip = held.present.clips.find(item => item.id === fixture.clip.id); assert.ok(clip?.kind === 'image');
	assert.equal(clip.sourceStartTicks, '90000000000');
	assert.deepEqual(held.present.sources, fixture.project.sources);
	const restored = runtime.executeCommand(held, { type: 'clip/trim', clipId: fixture.clip.id,
		timelineStartFrame: 0 }).present.clips.find(item => item.id === fixture.clip.id);
	assert.ok(restored?.kind === 'image'); assert.equal(restored.sequenceStartFrame, 0);
	assert.equal(restored.sequenceFrameCount, 26 * 3_600); assert.equal(restored.sourceStartTicks, '0');
});
