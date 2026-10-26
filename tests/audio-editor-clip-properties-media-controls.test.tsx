/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import ClipPropertiesPanel from '../src/common/editor/ui/inspector/ClipPropertiesPanel.tsx';
import { createAudioClip, createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { ENGLISH_COPY as copy } from '../src/common/i18n/catalogs.js';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

test('media controls sit beside their related fields and obsolete menu choices are removed', async () => {
	const f = await fixture();
	try {
		assert.equal(f.dom.one('[data-clip-properties-detail="track"]').textContent, '48 kHz');
		const heading = f.dom.one('[data-group="speed"]').querySelector('h3'); assert.ok(heading);
		assert.ok(heading.querySelector('[data-clip-properties-field="voice"]'));
		assert.equal(f.field('reverse').parentNode, f.field('invert').parentNode);
		assert.ok(f.field('invert').querySelector('[data-glyph="Phase"]'));
		assert.equal(f.dom.find('[data-clip-properties-field="fade-in-shape"]'), null);
		assert.equal(f.dom.find('[data-clip-properties-field="fade-out-shape"]'), null);
		const reset = f.dom.one('[data-clip-properties-action="reset-pitch-speed"]');
		const render = f.dom.one('[data-clip-properties-action="render-pitch-speed"]');
		assert.equal(reset.parentNode, render.parentNode);
		await f.click('[data-clip-audio-settings]');
		for (const text of [copy.clipTimecodeFields, copy.clipPitchUnit, copy.fadeInShape, copy.fadeOutShape, copy.preserveFormants, copy.normalizePeak]) {
			assert.equal(f.dom.container.querySelectorAll('[role="menuitem"], [role="menuitemcheckbox"]').some(item => item.textContent === text), false, text);
		}
	} finally { await f.cleanup(); }
});

test('inline pitch units, phase, voice, stretch, render and normalization invoke the native actions', async () => {
	const f = await fixture();
	try {
		await f.click('[data-clip-pitch-unit]');
		assert.equal(f.dom.one('[data-clip-pitch-unit]').getAttribute('aria-pressed'), 'true');
		assert.equal(f.field('pitch').querySelector('input')?.getAttribute('aria-label'), copy.clipPitchPercent);
		assert.deepEqual(f.calls, [], 'a display-unit change must not alter the clip');
		await f.click('[data-clip-properties-field="invert"]');
		const voice = f.field('voice').querySelector('input'); assert.ok(voice);
		await act(async () => reactProps(voice).onChange({ currentTarget: { checked: true } }));
		await f.click('[data-clip-properties-field="stretch-tempo"]');
		await f.click('[data-clip-properties-action="render-pitch-speed"]');
		await f.click('[data-clip-properties-action="normalize-peak"]');
		await f.click('[data-clip-properties-action="normalize-loudness"]');
		assert.deepEqual(f.calls, [
			['update', 'clip', { inverted: true }], ['setTimePitch', 'clip', { preserveFormants: true }],
			['toggleStretchToTempo', 'clip'], ['renderPitchSpeed', 'clip'], ['normalizePeak', 'clip'], ['normalizeLoudness', 'clip'],
		]);
	} finally { await f.cleanup(); }
});

test('format drafts stay local until reinterpret or resample applies the selected rate and depth', async () => {
	const f = await fixture();
	try {
		const rate = f.field('format-rate').querySelector('input'); assert.ok(rate);
		await act(async () => reactProps(rate).onChange({ currentTarget: { value: '8000' }, target: { value: '8000' } }));
		assert.deepEqual(f.calls, []);
		await f.click('[data-clip-properties-action="reinterpret"]');
		await f.click('[data-clip-properties-action="resample"]');
		assert.deepEqual(f.calls, [
			['reinterpret', 'clip', { sampleRate: 8000, sampleFormat: 'int16' }],
			['resample', 'clip', { sampleRate: 8000, sampleFormat: 'int16' }],
		]);
	} finally { await f.cleanup(); }
});

test('rate-only edits retain an imported wide PCM format until another depth is chosen', async () => {
	const f = await fixture('int32');
	try {
		const rate = f.field('format-rate').querySelector('input'); assert.ok(rate);
		await act(async () => reactProps(rate).onChange({ currentTarget: { value: '8000' } }));
		await f.click('[data-clip-properties-action="reinterpret"]');
		assert.deepEqual(f.calls, [['reinterpret', 'clip', { sampleRate: 8000 }]]);
	} finally { await f.cleanup(); }
});

test('mixed phase and tempo toggles expose their indeterminate state as checkboxes', async () => {
	const f = await fixture('int16', true);
	try {
		for (const name of ['invert', 'stretch-tempo']) {
			const control = f.field(name);
			assert.equal(control.getAttribute('role'), 'checkbox');
			assert.equal(control.getAttribute('aria-checked'), 'mixed');
		}
	} finally { await f.cleanup(); }
});

async function fixture(sampleFormat = 'int16', mixed = false) {
	const dom = installReactTestDom();
	const previousReact = Object.getOwnPropertyDescriptor(globalThis, 'React');
	const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const previousAct = globals.IS_REACT_ACT_ENVIRONMENT;
	globals.IS_REACT_ACT_ENVIRONMENT = true;
	Object.defineProperty(globalThis, 'React', { configurable: true, value: React });
	const source = createAudioSource({ id: 'source', storageKey: 'source', name: 'Recording', frameCount: 48_000, channelCount: 1, sampleRate: 48_000, sampleFormat });
	const clip = createAudioClip({ id: 'clip', sourceId: source.id, title: 'Recording', durationFrames: 48_000, sourceDurationFrames: 48_000, pitchCents: 100 });
	const clips = mixed ? [clip, createAudioClip({ id: 'clip-two', sourceId: source.id, title: 'Second', timelineStartFrame: 48_000,
		durationFrames: 48_000, sourceDurationFrames: 48_000, inverted: true, stretchToTempo: true })] : [clip];
	const project = createSoundscaperProject({ id: 'project', sources: [source], clips,
		tracks: [createAudioTrack({ id: 'track', name: 'Track', clipIds: clips.map(item => item.id) })],
		selection: { clipIds: clips.map(item => item.id), trackIds: ['track'], startFrame: 0, endFrame: 0 } });
	const calls: unknown[][] = [];
	const clipActions = Object.fromEntries(['update', 'setTimePitch', 'toggleStretchToTempo', 'renderPitchSpeed', 'normalizePeak', 'normalizeLoudness', 'reinterpret', 'resample'].map(action =>
		[action, (...args: unknown[]) => { calls.push([action, ...args]); }]));
	const controller = { project, actions: { clip: clipActions } };
	const root = createRoot(dom.container as unknown as Element);
	await act(async () => root.render(<ClipPropertiesPanel controller={controller} snapshot={{ project, selectedClipId: 'clip', selectedClipIds: clips.map(item => item.id), capabilities: { audioEffects: true } }}
		copy={copy} run={operation => operation()} />));
	return { dom, calls, field: (name: string) => dom.one(`[data-clip-properties-field="${name}"]`),
		click: async (selector: string, handler = 'onClick', event?: unknown) => {
			const element = dom.one(selector);
			await act(async () => (reactProps(element)[handler] as (event: unknown) => unknown)(event ?? { currentTarget: element }));
		},
		cleanup: async () => {
			await act(async () => root.unmount()); globals.IS_REACT_ACT_ENVIRONMENT = previousAct;
			if (previousReact) Object.defineProperty(globalThis, 'React', previousReact); else Reflect.deleteProperty(globalThis, 'React');
			dom.restore();
		},
	};
}
