/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act, useSyncExternalStore } from 'react';
import ClipPropertiesPanel from '../src/common/editor/ui/inspector/ClipPropertiesPanel.tsx';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { selectionControllerCustody, selectionWav } from './helpers/selection-controller-custody.tsx';
import { clipboardDocument, clipboardProject } from './helpers/clipboard-source-custody.ts';
import { readCustodyPcm } from './helpers/audio-project-archive-pcm-custody.ts';
import { assertPcmChannelsEqual } from './helpers/assert-pcm-samples.ts';
import { reactProps } from './helpers/react-test-dom.ts';

type Fixture = Awaited<ReturnType<typeof selectionControllerCustody>>;
function Properties({ f }: Readonly<{ f: Fixture }>) {
	const snapshot = useSyncExternalStore(f.controller.subscribe, f.controller.getSnapshot, f.controller.getSnapshot);
	const project = clipboardProject(snapshot.project);
	return <ClipPropertiesPanel controller={f.controller} snapshot={{ ...snapshot, project }} copy={ENGLISH_COPY} run={f.fixture.run} />;
}

test('an omitted inline clip rate cannot rewrite the real resampled source, history or archive PCM', async context => {
	const f = await selectionControllerCustody(context, selectionWav('browser-tone-a.wav', 38_400, 2, 48_000, 330));
	const { controller, fixture, store } = f;
	const rate = () => fixture.dom.one('[data-clip-properties-field="format-rate"]').querySelector('input');
	const action = (name: string) => fixture.dom.one(`[data-clip-properties-action="${name}"]`);
	try {
		const original = clipboardProject(controller.project), clip = original.clips[0]; assert.ok(clip?.kind === 'audio');
		await controller.actions.timeline.selectClip(clip.id);
		const before = clipboardProject(controller.project), entries = controller.getSnapshot().history.undoEntries.length;
		await fixture.render(<Properties f={f} />);
		const initial = rate(); assert.ok(initial); assert.equal(initial.value, '48000');
		await act(async () => { reactProps(initial).onChange({ currentTarget: { value: '24000' } }); });
		await act(async () => { reactProps(action('resample')).onClick(); await fixture.settle(); });
		const converted = clipboardProject(controller.project), current = converted.clips.find(value => value.id === clip.id); assert.ok(current?.kind === 'audio');
		const source = converted.sources.find(value => value.id === current.sourceId); assert.ok(source?.kind === 'audio');
		assert.deepEqual([source.sampleRate, source.originalSampleRate, source.frameCount, source.channelCount], [24_000, 48_000, 19_200, 2]);
		assert.deepEqual([current.timelineStartFrame, current.durationFrames, current.sourceStartFrame, current.sourceDurationFrames], [0, 38_400, 0, 19_200]);
		assert.deepEqual([current.fadeInFrames, current.fadeOutFrames], [clip.fadeInFrames, clip.fadeOutFrames]);
		assert.equal(controller.getSnapshot().history.undoEntries.length, entries + 1); assert.equal(rate()?.value, '24000');
		assert.equal(fixture.dom.one('[data-clip-source-sample-rate]').getAttribute('data-clip-source-sample-rate'), '24000');
		const derived = await readCustodyPcm(store, source);
		for (const [channel, samples] of derived.entries()) for (let frame = 0; frame < samples.length; frame++) {
			const expected = Math.sin(2 * Math.PI * 330 * frame / 24_000 + (channel ? Math.PI / 3 : 0)) * .35;
			// The independent tone oracle permits the bounded filter's clipped edge window, but tightly checks its complete windows.
			assert.ok(Math.abs(samples[frame]! - expected) < (frame < 48 || frame >= samples.length - 48 ? .02 : .0002), `resampled channel ${channel}, frame ${frame}`);
		}
		const history = structuredClone(controller.getSnapshot().history), blank = rate(); assert.ok(blank);
		await act(async () => { reactProps(blank).onChange({ currentTarget: { value: '' } }); });
		assert.equal(action('resample').hasAttribute('disabled'), true); assert.equal(action('reinterpret').hasAttribute('disabled'), true);
		assert.match(fixture.dom.one('[role="alert"]').textContent, /sample rate/iu);
		await act(async () => { reactProps(action('resample')).onClick(); reactProps(action('reinterpret')).onClick(); await fixture.settle(); });
		assert.deepEqual(controller.project, converted); assert.deepEqual(controller.getSnapshot().history, history);
		assertPcmChannelsEqual(await readCustodyPcm(store, source), derived, 'invalid draft preserves every converted sample');
		await act(async () => { reactProps(blank).onChange({ currentTarget: { value: '24000' } }); });
		assert.equal(rate()?.value, '24000');
		await act(async () => { controller.actions.edit.undo(); });
		assert.equal(rate()?.value, '48000'); assert.deepEqual(clipboardDocument(clipboardProject(controller.project)), clipboardDocument(before));
		assert.equal(fixture.dom.one('[data-clip-source-sample-rate]').getAttribute('data-clip-source-sample-rate'), '48000');
		await act(async () => { controller.actions.edit.redo(); });
		assert.equal(rate()?.value, '24000'); assert.deepEqual(clipboardDocument(clipboardProject(controller.project)), clipboardDocument(converted));
		await f.archive((name, channels) => { assert.equal(name, 'browser-tone-a.wav (24000 Hz)'); assertPcmChannelsEqual(channels, derived, 'every actual resampled sample survives fresh Scape'); });
	} finally { await f.dispose(); }
});
