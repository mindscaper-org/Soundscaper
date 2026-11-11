/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act, useSyncExternalStore } from 'react';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createAudioClip, createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { loadStoredSourceChannels } from '../src/common/editor/clip-time-pitch-cache-channels.js';
import ClipPropertiesPanel from '../src/common/editor/ui/inspector/ClipPropertiesPanel.tsx';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { createClipboardCustody, clipboardProject } from './helpers/clipboard-source-custody.ts';
import { mountControllerDataDom } from './helpers/controller-data-dom.ts';
import { reactProps } from './helpers/react-test-dom.ts';
import { readCustodyPcm } from './helpers/audio-project-archive-pcm-custody.ts';

type Custody = Awaited<ReturnType<typeof createClipboardCustody>>;
type Fixture = ReturnType<typeof mountControllerDataDom>;
function Properties({ controller, fixture }: Readonly<{ controller: Custody['controller']; fixture: Fixture }>) {
	const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
	return React.createElement(ClipPropertiesPanel, { controller, snapshot: { ...snapshot, project: clipboardProject(snapshot.project) },
		copy: ENGLISH_COPY, run: fixture.run });
}

function assertConstantPcm(channels: readonly Float32Array[], frames: number, filtered: boolean): void {
	assert.equal(channels.length, 6);
	for (const [channel, samples] of channels.entries()) {
		assert.equal(samples.length, frames);
		const expected = (channel + 1) / 16;
		let bad = -1;
		for (let frame = 0; frame < frames; frame++) {
			const value = samples[frame]!;
			// Clipped sinc windows can ring at the two source edges; the entire
			// interior must retain this independently authored constant signal.
			const valid = filtered && (frame < 48 || frame >= frames - 48)
				? value >= expected * .5 && value <= expected * 1.25 : Math.abs(value - expected) < 1e-6;
			if (!valid) { bad = frame; break; }
		}
		assert.equal(bad, -1, `channel ${channel}, frame ${bad}: ${samples[bad]} must retain constant ${expected}`);
	}
}

for (const scope of ['clip', 'track'] as const) test(`NP059: ${scope} Resample reads nonresident multichannel audio`, async context => {
	const custody = await createClipboardCustody(context), { controller, store } = custody;
	const source = createAudioSource({ id: 'source', sampleRate: 48_000, frameCount: 1_440_000, channelCount: 6 });
	const original = createSoundscaperProject({ id: scope === 'clip' ? 'stored-surround' : 'stored-track', sources: [source],
		clips: [createAudioClip({ id: 'clip', title: 'Surround recording', sourceId: source.id, durationFrames: source.frameCount, sourceDurationFrames: source.frameCount })],
		tracks: [createAudioTrack({ id: 'voice', clipIds: ['clip'] })] });
	const pcm = Array.from({ length: 6 }, (_, channel) => new Float32Array(1_440_000).fill((channel + 1) / 16));
	await custody.open(original, new Map([[source.id, pcm]]));
	assertConstantPcm(await readCustodyPcm(store, source), 1_440_000, false);
	controller.actions.timeline.selectClip('clip');
	const before = clipboardProject(controller.project), entries = controller.getSnapshot().history.undoEntries.length;
	let fixture: Fixture | undefined;
	try {
		if (scope === 'clip') {
			fixture = mountControllerDataDom();
			const ui = fixture;
			await ui.render(React.createElement(Properties, { controller, fixture: ui }));
			const field = ui.dom.one('[data-clip-properties-field="format-rate"]').querySelector('input'); assert.ok(field);
			assert.equal(field.value, '48000');
			await act(async () => { reactProps(field).onChange({ currentTarget: { value: '24000' } }); });
			await act(async () => { reactProps(ui.dom.one('[data-clip-properties-action="resample"]')).onClick(); await ui.settle(); });
			assert.equal(ui.dom.one('[data-clip-source-sample-rate]').getAttribute('data-clip-source-sample-rate'), '24000');
		} else await controller.actions.track.resample('voice', 24_000);
		const after = clipboardProject(controller.project), clip = after.clips[0]; assert.ok(clip?.kind === 'audio');
		const resampled = after.sources.find(candidate => candidate.id === clip.sourceId); assert.ok(resampled?.kind === 'audio');
		assert.deepEqual([resampled.sampleRate, resampled.frameCount, resampled.channelCount], [24_000, 720_000, 6]);
		assert.deepEqual([clip.timelineStartFrame, clip.durationFrames, clip.sourceStartFrame, clip.sourceDurationFrames], [0, 1_440_000, 0, 720_000]);
		assert.equal(after.sampleRate, 48_000); assert.equal(controller.getSnapshot().history.undoEntries.length, entries + 1);
		assertConstantPcm(await readCustodyPcm(store, resampled), 720_000, true);
		await act(async () => { await controller.actions.project.flush(); }); assert.deepEqual(await store.loadProject(after.id), after);
		await act(async () => { controller.actions.edit.undo(); });
		assert.deepEqual(controller.project?.clips, before.clips);
		if (fixture) assert.equal(fixture.dom.one('[data-clip-source-sample-rate]').getAttribute('data-clip-source-sample-rate'), '48000');
		await act(async () => { controller.actions.edit.redo(); });
		assert.deepEqual(controller.project?.clips, after.clips);
		if (fixture) {
			assert.equal(fixture.dom.one('[data-clip-source-sample-rate]').getAttribute('data-clip-source-sample-rate'), '24000');
			await act(async () => { await custody.archive((name, channels) => {
				const derived = name !== source.name;
				assert.equal(name, derived ? `${source.name} (24000 Hz)` : source.name);
				assertConstantPcm(channels, derived ? 720_000 : 1_440_000, derived);
			}); });
		}
	} finally { if (fixture) await fixture.dispose(); }
});

test('NP059: wider source-edit reads preserve StaffPad default admission', async () => {
	const source = { frameCount: 2, channelCount: 6, storageKey: 'wide' };
	const store = { readSourceChunks: async function* () { yield { channels: Array.from({ length: 6 }, () => Float32Array.of(.25, .5)) }; } };
	await assert.rejects(loadStoredSourceChannels(store, source), /between 1 and 2/u);
	const channels = await loadStoredSourceChannels(store, source, { maximumChannelCount: 64 });
	assert.equal(channels.length, 6);
	assert.deepEqual([...channels[5]!], [.25, .5]);
	await assert.rejects(loadStoredSourceChannels(store, source, { maximumChannelCount: 65 }), /between 1 and 64/u);
});
