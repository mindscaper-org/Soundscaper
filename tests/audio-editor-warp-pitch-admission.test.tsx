/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import ClipPropertiesPanel from '../src/common/editor/ui/inspector/ClipPropertiesPanel.tsx';
import { createClipPropertyService } from '../src/common/editor/controller/clip-video/internal/clip/clip-property-service.ts';
import { EditorControllerLifetime, EditorProjectGeneration } from '../src/common/editor/controller/shared/lifecycle.ts';
import { createAudioClip, createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { projectForRuntimeConsumers } from '../src/common/editor/project-current-runtime.ts';
import { resolveRuntimeClipProjection } from '../src/common/editor/runtime-clip-projection.ts';
import type { AudioEditorCommand } from '../src/common/editor/commands/protocol.ts';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { installReactTestDom } from './helpers/react-test-dom.ts';

const reason = 'Independent pitch editing is unavailable while an audio warp map controls playback.';

test('a changed independent pitch cannot silently publish under an authored warp map', () => {
	const h = harness(projectFixture({ warped: true }));
	assert.throws(() => h.service.setClipTimePitch('one', { pitchCents: 1_200 }), { name: 'RangeError', message: reason });
	assert.deepEqual(h.commits, []);
});

test('merged pitch validation rejects an unsupported target before publishing any clip', () => {
	const h = harness(projectFixture({ warped: true, ordinaryPeer: true }));
	assert.throws(() => h.service.setClipsTimePitch(['two', 'one'], { pitchCents: 300 }), { message: reason });
	assert.deepEqual(h.commits, []);
});

test('a stale ordinary-clip pitch callback rechecks the current authored map', () => {
	const h = harness(projectFixture());
	const staleCommit = (pitchCents: number) => h.service.setClipTimePitch('one', { pitchCents });
	h.replace(projectFixture({ warped: true }));
	assert.throws(() => staleCommit(600), { message: reason });
	assert.deepEqual(h.commits, []);
});

for (const pitchCents of [-1_200, 1_200]) test(`ordinary pitch ${pitchCents} remains editable`, () => {
	const h = harness(projectFixture());
	h.service.setClipTimePitch('one', { pitchCents });
	assert.equal(h.change().pitchCents, pitchCents);
});

test('linked warped pitch remains a real rate change', () => {
	const h = harness(projectFixture({ warped: true, linked: true }));
	h.service.setClipTimePitch('one', { pitchCents: 1_200 });
	assert.equal(h.change().speedRatio, 2);
	assert.equal(h.change().durationFrames, 24_000);
});

test('one atomic action may enable linked pitch and change its audible rate', () => {
	const h = harness(projectFixture({ warped: true }));
	h.service.setClipTimePitch('one', { linkPitchAndTempo: true, pitchCents: 1_200 });
	assert.equal(h.change().speedRatio, 2);
});

test('a dormant native pitch hint survives unrelated, same-value and speed edits', () => {
	const h = harness(projectFixture({ warped: true, pitchCents: 600 }));
	for (const changes of [{ preserveFormants: true }, { pitchCents: 600 }, { speedRatio: 2 }]) {
		h.service.setClipTimePitch('one', changes);
		assert.equal(h.change().pitchCents, 600);
	}
});

test('Reset and explicit zero remain available to retire dormant hints', () => {
	const h = harness(projectFixture({ warped: true, pitchCents: 600 }));
	h.service.setClipTimePitch('one', { pitchCents: 0 });
	assert.equal(h.change().pitchCents, 0);
	h.service.resetClipPitchSpeed('one');
	assert.equal(h.change().pitchCents, 0);
});

test('turning linked mode off preserves its stored hints without adding a new pitch request', () => {
	const h = harness(projectFixture({ warped: true, linked: true, pitchCents: 600 }));
	h.service.setClipTimePitch('one', { linkPitchAndTempo: false });
	assert.equal(h.change().linkPitchAndTempo, false);
});

for (const mode of ['plain', 'warped', 'linked-warp', 'mixed'] as const) {
	test(`the shipped properties panel exposes truthful Pitch admission for ${mode}`, async () => {
		const project = projectFixture({ warped: mode !== 'plain', linked: mode === 'linked-warp', ordinaryPeer: mode === 'mixed' });
		const dom = installReactTestDom();
		const priorReact = Object.getOwnPropertyDescriptor(globalThis, 'React');
		const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
		const priorAct = globals.IS_REACT_ACT_ENVIRONMENT;
		globals.IS_REACT_ACT_ENVIRONMENT = true;
		Object.defineProperty(globalThis, 'React', { configurable: true, value: React });
		const root = createRoot(dom.container as unknown as Element);
		try {
			await act(async () => root.render(<ClipPropertiesPanel controller={{ project, actions: { clip: {} } }}
				snapshot={{ project, selectedClipIds: project.clips.map(clip => clip.id) }} copy={ENGLISH_COPY} run={operation => operation()} />));
			const blocked = mode === 'warped' || mode === 'mixed';
			const field = dom.one('[data-clip-properties-field="pitch"]');
			assert.equal(field.querySelector('input')?.hasAttribute('disabled'), blocked);
			assert.equal(dom.one('[data-clip-properties-field="speed"]').querySelector('input')?.hasAttribute('disabled'), false);
			if (blocked) assert.equal(dom.one('[data-clip-pitch-admission]').getAttribute('title'), reason);
			assert.equal(field.querySelector('input')?.getAttribute('aria-label'), ENGLISH_COPY.clipPitchField);
		} finally {
			await act(async () => root.unmount());
			globals.IS_REACT_ACT_ENVIRONMENT = priorAct;
			if (priorReact) Object.defineProperty(globalThis, 'React', priorReact); else Reflect.deleteProperty(globalThis, 'React');
			dom.restore();
		}
	});
}

function projectFixture(options: { warped?: boolean; linked?: boolean; pitchCents?: number; ordinaryPeer?: boolean } = {}) {
	const source = createAudioSource({ id: 'source', sampleRate: 48_000, frameCount: 48_000, channelCount: 1 });
	const one = createAudioClip({ id: 'one', sourceId: source.id, title: 'Recording', durationFrames: 48_000,
		sourceDurationFrames: 48_000, linkPitchAndTempo: options.linked ?? false, pitchCents: options.pitchCents ?? 0,
		...(options.warped ? { warpMap: { feature: 'audio-warp', points: [
			{ outer: 0, source: 0, mode: 'forward' }, { outer: 48_000, source: 48_000, mode: 'forward' },
		] } } : {}) });
	const two = createAudioClip({ id: 'two', sourceId: source.id, timelineStartFrame: 96_000, durationFrames: 48_000, sourceDurationFrames: 48_000 });
	const clips = options.ordinaryPeer ? [one, two] : [one];
	const track = createAudioTrack({ id: 'track', clipIds: clips.map(clip => clip.id), locked: false });
	const admitted = createSoundscaperProject({ id: 'warp-pitch-admission', sources: [source], clips, tracks: [track] });
	return { ...projectForRuntimeConsumers(admitted), sources: [source], tracks: [track],
		clips: clips.map(clip => resolveRuntimeClipProjection(admitted, clip)) };
}

function harness(initial: ReturnType<typeof projectFixture>) {
	let project = initial;
	const lifetime = new EditorControllerLifetime(); lifetime.markReady();
	const generation = new EditorProjectGeneration(); generation.activate(project.id);
	const commits: AudioEditorCommand[] = [];
	const service = createClipPropertyService({ lifetime, copy: ENGLISH_COPY, sourceBuffers: new Map(),
		getProject: () => project, getSelectedClipId: () => 'one', editingBlocked: () => false,
		captureProject: () => generation.capture(), assertProject: token => generation.assertCurrent(token),
		analyzeChannels: async () => ({ peakAmplitude: 1, integratedLufs: -14 }), createId: prefix => prefix,
		commit: command => { commits.push(command); return project; } });
	return { service, commits, replace(next: typeof project) { project = next; }, change() {
		const command = commits.at(-1);
		assert.ok(command?.type === 'clip/transform-many');
		const transform = command.transforms[0]; assert.ok(transform);
		return transform.changes;
	} };
}
