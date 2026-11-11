/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act, useSyncExternalStore } from 'react';
import GeneratorDialog from '../src/common/editor/ui/dialogs/GeneratorDialog.jsx';
import { createTrackSelectionContextMenuItems } from '../src/common/editor/ui/timeline/track-selection-context-menu.ts';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { selectionControllerCustody, selectionWav } from './helpers/selection-controller-custody.tsx';
import { clipboardDocument, clipboardProject } from './helpers/clipboard-source-custody.ts';
import { reactProps } from './helpers/react-test-dom.ts';
import { readCustodyPcm } from './helpers/audio-project-archive-pcm-custody.ts';
import { assertPcmChannelsEqual } from './helpers/assert-pcm-samples.ts';
import { createAudioClip, createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { audioTrackChannelCount } from '../src/common/editor/project-audio-factory.js';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { applySoundscaperProjectCommand } from '../src/soundscaper/editor-project-commands.ts';
import { createAudioGeneratorService, type AudioGeneratorDocument } from '../src/common/editor/controller/edit/generator-service.ts';
import { createFixture } from './helpers/audio-editor-generator-service-fixture.ts';

for (const { widths, streamed, requestedWidth } of [
	{ widths: [1, 2], streamed: false }, { widths: [2, 1], streamed: false }, { widths: [2, 2, 6], streamed: false },
	{ widths: [1, 2], streamed: true }, { widths: [1, 2], streamed: false, requestedWidth: 2 },
]) {
	test(`signal generation retains channel intent ${widths.join(',')}, stream=${streamed}, explicit=${requestedWidth}`, async () => {
		let project = createSoundscaperProject({ id: 'project-a', sampleRate: 48_000,
			sources: widths.map((channelCount, index) => createAudioSource({ id: `source-${index}`, storageKey: `source-${index}`,
				sampleRate: 48_000, channelCount, frameCount: 100 })),
			clips: widths.map((_channelCount, index) => createAudioClip({ id: `clip-${index}`, sourceId: `source-${index}`,
				sourceStartFrame: 0, sourceDurationFrames: 100, durationFrames: 100, timelineStartFrame: 0 })),
			tracks: widths.map((_channelCount, index) => createAudioTrack({ id: `track-${index}`, clipIds: [`clip-${index}`] })) });
		project = applySoundscaperProjectCommand(project, { type: 'selection/set', startFrame: 0, endFrame: 100,
			trackIds: project.tracks.map(({ id }) => id), clipIds: [] });
		const before = project;
		let commits = 0;
		let ids = 0;
		let closedStreams = 0;
		const fixture = createFixture({ getProject: () => project as unknown as AudioGeneratorDocument,
			trackChannelCount: audioTrackChannelCount,
			createId: prefix => `generated-${prefix}-${++ids}`,
			...(streamed ? {
				generateStream: async (_type, options) => {
					const channelCount = Number(options.channelCount);
					return { type: 'silence', sampleRate: 48_000, frameCount: 100, channelCount,
						async *chunks() { yield Array.from({ length: channelCount }, () => new Float32Array(100)); },
						finish: async () => ({ version: 1, channelCount, levels: [] }),
						close() { closedStreams++; } };
				},
				createEmptyBuffer: async (channelCount, length, sampleRate) => {
					const channels = Array.from({ length: channelCount }, () => new Float32Array(length));
					return { length, sampleRate, numberOfChannels: channelCount, getChannelData: channel => channels[channel]! };
				},
			} : {}),
			commit: command => { project = applySoundscaperProjectCommand(project, command); commits++; } });
		fixture.state.selectedTrackId = 'track-0';
		await createAudioGeneratorService(fixture.dependencies).generateSignal('silence', { channelCount: requestedWidth });
		assert.equal(commits, 1);
		assert.deepEqual(project.tracks.map(track => audioTrackChannelCount(project, track)),
			requestedWidth ? widths.map(() => requestedWidth) : widths);
		assert.equal(closedStreams, streamed ? new Set(widths).size : 0);
		assert.equal(project.clips.length, widths.length);
		for (const clip of project.clips) {
			const source = project.sources.find(({ id }) => id === clip.sourceId);
			const audio = fixture.sourceBuffers.get(String(source?.storageKey));
			assert.ok(audio);
			assert.equal(audio.numberOfChannels, source?.channelCount);
			for (let channel = 0; channel < audio.numberOfChannels; channel++) {
				assert.equal(audio.getChannelData(channel).every(value => value === 0), true);
			}
		}
		assert.deepEqual(before.sources.map(({ channelCount }) => channelCount), widths);
	});
}

test('a later generator width failure rolls every unpublished source back without history', async () => {
	const project = createSoundscaperProject({ id: 'project-a', sampleRate: 48_000,
		sources: [1, 2].map(channelCount => createAudioSource({ id: `source-${channelCount}`, storageKey: `source-${channelCount}`,
			sampleRate: 48_000, channelCount, frameCount: 100 })),
		clips: [1, 2].map(channelCount => createAudioClip({ id: `clip-${channelCount}`, sourceId: `source-${channelCount}`,
			sourceStartFrame: 0, sourceDurationFrames: 100, durationFrames: 100, timelineStartFrame: 0 })),
		tracks: [1, 2].map(channelCount => createAudioTrack({ id: `track-${channelCount}`, clipIds: [`clip-${channelCount}`] })),
		selection: { startFrame: 0, endFrame: 100, trackIds: ['track-1', 'track-2'], clipIds: [] } });
	let ids = 0;
	const fixture = createFixture({ getProject: () => project as unknown as AudioGeneratorDocument,
		trackChannelCount: audioTrackChannelCount,
		createId: prefix => `generated-${prefix}-${++ids}` });
	fixture.state.selectedTrackId = 'track-1';
	let writes = 0;
	fixture.dependencies.store.beginSourceWrite = async () => {
		if (++writes === 2) throw new Error('storage unavailable');
		return fixture.writer;
	};
	await assert.rejects(createAudioGeneratorService(fixture.dependencies).generateSignal('silence'), /storage unavailable/u);
	assert.equal(fixture.commits.length, 0);
	assert.equal(fixture.sourceBuffers.size, 0);
	assert.equal(fixture.sourcePeaks.size, 0);
	assert.equal(fixture.deletedSources.length, 2);
	assert.equal(fixture.state.audacityEffectProcessing, false);
});


test('actual Silence preserves the original mono/stereo recordings, channel menu, history and complete PCM custody', async context => {
	const mono = selectionWav('browser-mono-tone.wav', 38_400, 1, 48_000, 440), stereo = selectionWav('browser-tone-a.wav', 38_400, 2, 48_000, 330);
	const f = await selectionControllerCustody(context, mono), { controller, fixture } = f;
	let closed = 0;
	const Dialog = () => {
		const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
		return React.createElement(GeneratorDialog, { type: 'silence', controller, snapshot, copy: ENGLISH_COPY, locale: 'en', run: fixture.run, onClose: () => { closed++; } });
	};
	try {
		const empty = clipboardProject(controller.project).tracks.find(track => track.id === 'empty'); assert.ok(empty && Array.isArray(empty.clipIds) && empty.clipIds.length === 0);
		controller.actions.track.remove(empty.id);
		await controller.actions.project.importFiles([stereo.file]);
		const imported = clipboardProject(controller.project); assert.equal(imported.clips.length, 2); assert.equal(imported.tracks.length, 2); assert.equal(imported.sources.length, 2);
		const originalPcm = async () => {
			for (const input of [mono, stereo]) {
				const source = clipboardProject(controller.project).sources.find(value => value.name === input.file.name); assert.ok(source?.kind === 'audio');
				assertPcmChannelsEqual(await readCustodyPcm(f.store, source), input.pcm, `every original ${input.file.name} RIFF16 sample`);
			}
		};
		await originalPcm();
		const stereoSource = imported.sources.find(source => source.name === stereo.file.name); assert.ok(stereoSource?.kind === 'audio');
		const stereoClip = imported.clips.find(clip => clip.sourceId === stereoSource.id); assert.ok(stereoClip);
		const stereoTrack = imported.tracks.find(track => Array.isArray(track.clipIds) && track.clipIds.includes(stereoClip.id)); assert.ok(stereoTrack);
		const expectStereoMenu = () => {
			const current = clipboardProject(controller.project);
			const tracks = current.tracks.map(track => { assert.ok(Array.isArray(track.clipIds) && track.clipIds.every((id: unknown): id is string => typeof id === 'string')); return { ...track, clipIds: track.clipIds }; });
			const track = tracks.find(value => value.id === stereoTrack.id); assert.ok(track);
			const capabilities: unknown = controller.getSnapshot().capabilities; assert.ok(capabilities && typeof capabilities === 'object');
			const audioEffects: unknown = Reflect.get(capabilities, 'audioEffects'); assert.equal(audioEffects, true);
			const menu = createTrackSelectionContextMenuItems({ project: { tracks, clips: current.clips, sources: current.sources }, track,
				copy: ENGLISH_COPY, audioEffects: audioEffects === true, blocked: false, actions: controller.actions.track });
			const split = menu.audio[0]?.items?.find(item => item.id === 'track-split-stereo-to-lr'); assert.ok(split); assert.equal(split.label, 'Split stereo to left/right mono'); assert.equal(split.disabled, false);
		};
		expectStereoMenu();
		await controller.actions.timeline.selectClip(imported.clips.find(clip => clip.sourceId !== stereoSource.id)!.id);
		controller.actions.timeline.selectAll();
		const before = clipboardProject(controller.project), history = controller.getSnapshot().history.undoEntries.length;
		assert.deepEqual([before.selection.startFrame, before.selection.endFrame], [0, 38_400]);
		assert.deepEqual(new Set(before.selection.trackIds), new Set(before.tracks.map(track => track.id)));
		await fixture.render(React.createElement(Dialog));
		const button = fixture.dom.container.querySelectorAll('button').find(node => node.textContent === ENGLISH_COPY.generate); assert.ok(button); assert.equal(button.hasAttribute('disabled'), false);
		await act(async () => { reactProps(button).onClick(); await Promise.resolve(); await fixture.settle(); });
		assert.equal(closed, 1);
		const after = clipboardProject(controller.project); assert.equal(after.clips.length, 2); assert.equal(after.tracks.length, 2);
		assert.deepEqual(after.tracks.map(track => track.id), before.tracks.map(track => track.id));
		for (const [index, track] of after.tracks.entries()) {
			const clipIds = track.clipIds; assert.ok(Array.isArray(clipIds)); assert.equal(clipIds.length, 1);
			const clipId: unknown = clipIds[0]; assert.equal(typeof clipId, 'string');
			const clip = after.clips.find(value => value.id === clipId); assert.ok(clip?.kind === 'audio');
			const source = after.sources.find(value => value.id === clip.sourceId); assert.ok(source?.kind === 'audio');
			assert.deepEqual([source.sampleRate, source.frameCount, source.channelCount], [48_000, 38_400, index === 0 ? 1 : 2]);
			assert.equal(source.name, ENGLISH_COPY.silenceGenerator);
			assert.deepEqual([clip.timelineStartFrame, clip.durationFrames, clip.sourceStartFrame, clip.sourceDurationFrames], [0, 38_400, 0, 38_400]);
			assert.ok(!before.sources.some(value => value.id === source.id));
		}
		assert.equal(controller.getSnapshot().history.undoEntries.length, history + 1); expectStereoMenu();
		await act(async () => { controller.actions.edit.undo(); }); assert.deepEqual(clipboardDocument(clipboardProject(controller.project)), clipboardDocument(before)); expectStereoMenu(); await originalPcm();
		await act(async () => { controller.actions.edit.redo(); }); assert.deepEqual(clipboardDocument(clipboardProject(controller.project)), clipboardDocument(after)); expectStereoMenu();
		await fixture.render(null);
		const reopened = await f.archive((name, channels) => {
			if (name === stereo.file.name) assertPcmChannelsEqual(channels, stereo.pcm, 'every original stereo RIFF16 sample');
			else {
				assert.equal(name, ENGLISH_COPY.silenceGenerator); assert.ok(channels.length === 1 || channels.length === 2);
				for (const channel of channels) { assert.equal(channel.length, 38_400); for (const sample of channel) assert.equal(sample, 0, 'real CPU Silence sample'); }
			}
		});
		assert.equal(reopened.sources.length, 2, 'only the two live generated replacement sources belong in the final archive');
		assert.deepEqual(clipboardDocument(reopened), clipboardDocument(after));
	} finally { await f.dispose(); }
});
