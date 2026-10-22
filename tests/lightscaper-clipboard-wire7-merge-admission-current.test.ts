/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeAudioEditorClipboardDescriptor, isAudioEditorLabelClipboardDescriptor } from '../src/common/editor/commands/clipboard-codec.ts';
import { normalizeAudioEditorClipboardDescriptorV7 } from '../src/common/editor/commands/clipboard-codec-v7.ts';
import { isCurrentClipboardPasteCommandV2 } from '../src/common/editor/commands/clipboard-command-v2.ts';
import { preparePasteCommand } from '../src/common/editor/commands/clipboard-runtime.js';
import { createClipboardDescriptorV7, preparePasteCommandV7 } from '../src/common/editor/commands/clipboard-runtime-v7.ts';
import { createEditorCommandMutationTransactionForFrameV2 } from '../src/common/editor/commands/mutation-transaction.ts';
import { createSelectedLabelClipboardService } from '../src/common/editor/controller/edit/internal/selected-label-clipboard.ts';
import { createAudioSource, createAudioTrack, createLabelTrack } from '../src/common/editor/project-media-factory.ts';
import { resolveRuntimeProjectProjection } from '../src/common/editor/runtime-clip-projection.ts';
import { createAudioEditorSessionControllerV2 } from '../src/common/editor/session-v2.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { applySoundscaperProjectCommand } from '../src/soundscaper/editor-project-commands.ts';
import { createFramescaperProject } from '../src/framescaper/editor-project.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE as PROFILE } from '../src/framescaper/editor-project-runtime-profile.ts';
import { framescaperProjectForEditClipboardConsumers } from '../src/framescaper/editor-project-runtime.ts';
import { framescaperV20Options } from './helpers/framescaper-model-fixture.ts';

function labelClipboard() {
	return normalizeAudioEditorClipboardDescriptor({ schemaVersion: 7, sampleRate: 48_000, durationFrames: 1,
		tracks: [], annotations: [], takeGroups: [], labels: [{ title: 'Cue', color: 'auto', anchor: 'sample',
			startOffsetFrame: 0, endOffsetFrame: 0, opaqueExtensions: {} }] });
}

const REF = { storageKey: `lut-sha256:${'ab'.repeat(32)}`, sha256: 'ab'.repeat(32), byteLength: 84,
	size: 2, domainMin: [0, 0, 0], domainMax: [1, 1, 1] };
function frameClipboard() {
	const options = framescaperV20Options();
	const project = createFramescaperProject(PROFILE, { ...options,
		clips: (options.clips as readonly Record<string, unknown>[]).map(clip => clip.id === 'video-clip'
			? { ...clip, videoEffects: [{ id: 'cube', type: 'cube-lut-profile-v1', enabled: false, params: { lut: REF } }] }
			: clip) });
	const current = framescaperProjectForEditClipboardConsumers(PROFILE, project);
	const descriptor = createClipboardDescriptorV7(current, { startFrame: 0, endFrame: 24_000, trackIds: ['video-track'] });
	let next = 0;
	const command = preparePasteCommandV7(descriptor, { project: current, atFrame: 48_000 }, prefix => `${prefix}-${String(++next)}`);
	return { project, current, descriptor, command };
}

test('Label7 takes the native label dispatcher while Frame7 remains available to its media owner', () => {
	let project = createSoundscaperProject({ tracks: [createLabelTrack({ id: 'labels' })] });
	const state: Parameters<typeof createSelectedLabelClipboardService>[0]['state'] = {
		clipboard: labelClipboard(), selectedTrackId: 'labels', selectedClipId: null,
	};
	let next = 0;
	const service = createSelectedLabelClipboardService({ state,
		getProject: () => resolveRuntimeProjectProjection(project), getPositionFrames: () => 24_000,
		createId: prefix => `${prefix}-${String(++next)}`,
		updateSelection: command => { project = applySoundscaperProjectCommand(project, command); },
		commit: command => { project = applySoundscaperProjectCommand(project, command); },
		prepareClipboard: descriptor => () => { state.clipboard = descriptor; },
		publish() {}, copy: { labelTrackMissing: 'Missing label track' }, setStatus() {},
	});
	assert.equal(service.handle('paste'), true);
	const track = project.tracks[0]; assert.ok(track?.type === 'label');
	assert.deepEqual(track.labels.map(label => [label.title, label.startFrame, label.endFrame]), [['Cue', 24_000, 24_000]]);
	state.clipboard = frameClipboard().descriptor;
	assert.equal(service.handle('paste'), false, 'a valid Frame wire7 is not selected label content');
	assert.equal(track.labels.length, 1);
});

test('Frame7 dispatches actual admitted resource leaves without becoming Label7 or legacy media', () => {
	const { project, current, descriptor, command } = frameClipboard();
	assert.equal(isAudioEditorLabelClipboardDescriptor(descriptor), false);
	assert.equal(isCurrentClipboardPasteCommandV2(command), true);
	assert.throws(() => normalizeAudioEditorClipboardDescriptor(descriptor), /Unsupported clipboard schema/u);
	const draft = structuredClone(current);
	createEditorCommandMutationTransactionForFrameV2(project, current).mutate(draft, command);
	const clips = draft.clips as readonly { timelineStartFrame: number; videoEffects?: readonly { id: string; params: unknown }[] }[];
	const clip = clips.find(clip => clip.timelineStartFrame === 48_000); assert.ok(clip);
	assert.deepEqual(clip.videoEffects?.[0]?.params, { lut: REF });
	assert.notEqual(clip.videoEffects?.[0]?.id, 'cube');
});

test('Label7 cannot enter the Frame media mutation dispatcher or legacy media paste planner', () => {
	const { project, current, command } = frameClipboard();
	const clipboard = labelClipboard();
	assert.equal(isAudioEditorLabelClipboardDescriptor(clipboard), true);
	const labelMediaCommand = { ...command, clipboard };
	assert.equal(isCurrentClipboardPasteCommandV2(labelMediaCommand), false);
	assert.throws(() => preparePasteCommand(clipboard), /label clipboard/iu);
	const draft = structuredClone(current), before = structuredClone(draft);
	assert.throws(() => createEditorCommandMutationTransactionForFrameV2(project, current).mutate(draft, labelMediaCommand), /label clipboard/iu);
	assert.deepEqual(draft, before);
});

test('mixed wire7 shapes and accessor label claims refuse before either owner mutates data', () => {
	const { project, current, descriptor, command } = frameClipboard();
	const labels = labelClipboard(); assert.ok(isAudioEditorLabelClipboardDescriptor(labels));
	const mixed = { ...descriptor, labels: labels.labels };
	assert.throws(() => normalizeAudioEditorClipboardDescriptor(mixed), /label|empty/iu);
	assert.throws(() => normalizeAudioEditorClipboardDescriptorV7(mixed), /unsupported field/iu);
	const draft = structuredClone(current), before = structuredClone(draft);
	assert.throws(() => createEditorCommandMutationTransactionForFrameV2(project, current).mutate(draft, { ...command, clipboard: mixed }), /label|empty/iu);
	assert.deepEqual(draft, before);
	let reads = 0;
	const accessor = { ...descriptor };
	Object.defineProperty(accessor, 'labels', { enumerable: true, get() { reads++; throw new Error('must not read'); } });
	assert.throws(() => isAudioEditorLabelClipboardDescriptor(accessor), /data|accessor/iu);
	assert.equal(reads, 0);
});

test('legacy descriptor6 still uses the actual legacy media paste dispatcher', () => {
	const project = createSoundscaperProject({ sources: [createAudioSource({ id: 'source', sampleRate: 48_000,
		frameCount: 48_000, channelCount: 1 })], tracks: [createAudioTrack({ id: 'audio-track' })] });
	const descriptor = normalizeAudioEditorClipboardDescriptor({ schemaVersion: 6, sampleRate: 48_000, durationFrames: 1000,
		annotations: [], takeGroups: [], tracks: [{ sourceTrackId: 'audio-track', sourceTrackName: 'Audio', sourceTrackType: 'audio',
			sourceLaneGroupId: null, sourceSequenceId: 'main-sequence', clips: [{ key: 'source-clip', sourceId: 'source',
				kind: 'audio', offsetFrame: 0, sourceStartFrame: 0, durationFrames: 1000 }] }] });
	const command = preparePasteCommand(descriptor, { project, atFrame: 0 });
	assert.equal(isCurrentClipboardPasteCommandV2(command), false);
	const pasted = applySoundscaperProjectCommand(project, command);
	assert.equal(pasted.clips.length, 1);
	assert.equal(pasted.clips[0]?.sourceId, 'source');
});

test('the real current session keeps Label7 on wrapper1 and Frame7 on wrapper2 without losing resource roots', () => {
	const session = createAudioEditorSessionControllerV2({ currentSchemaVersion: 1 });
	try {
		session.openProject({ schemaVersion: 1, id: 'origin', title: 'Origin', sampleRate: 48_000,
			sources: [{ id: 'video-source', storageKey: 'video-original' }], tracks: [], clips: [] });
		const labels = labelClipboard();
		session.setClipboard(labels);
		assert.equal(session.serialize().clipboard?.schemaVersion, 1);
		assert.deepEqual(session.serialize().clipboard?.descriptor, labels);
		assert.deepEqual(session.clipboardForProject('origin')?.sources, []);
		const { descriptor } = frameClipboard();
		session.setClipboard(descriptor);
		assert.equal(session.serialize().clipboard?.schemaVersion, 2);
		assert.deepEqual(new Set(session.getHistoryStorageKeys()), new Set(['video-original', REF.storageKey]));
		const before = session.serialize().clipboard;
		assert.ok(isAudioEditorLabelClipboardDescriptor(labels));
		assert.throws(() => session.setClipboard({ ...descriptor, labels: labels.labels }), /label|empty/iu);
		assert.deepEqual(session.serialize().clipboard, before, 'malformed cross-family replacement remains atomic');
		session.setClipboard(labels);
		assert.equal(session.serialize().clipboard?.schemaVersion, 1);
		assert.deepEqual([...session.getHistoryStorageKeys()], ['video-original']);
	} finally { session.dispose(); }
});
