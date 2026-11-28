/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import test, { type TestContext } from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { createAudioClip, createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import ClipPropertiesPanel from '../src/common/editor/ui/inspector/ClipPropertiesPanel.tsx';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

const projectRate = 48_000;
const sourceRate = 44_100;
const source = createAudioSource({ id: 'source', sampleRate: sourceRate, frameCount: 220_500, channelCount: 1 });
const clip = createAudioClip({ id: 'clip', sourceId: source.id, timelineStartFrame: 192_001,
	durationFrames: 96_003, sourceStartFrame: 44_101, sourceDurationFrames: 88_202, fadeInFrames: 12_345, fadeOutFrames: 1 });

test('the obsolete clip-property time fields adapter is absent', () => {
	assert.equal(existsSync(new URL('../src/common/editor/ui/inspector/ClipPropertiesTimeFields.tsx', import.meta.url)), false);
});

test('numeric clip properties preserve exact project samples and the separate source clock', async context => {
	const f = await fixture(context);
	for (const [name, frames, rate] of [
		['start', 192_001, projectRate], ['length', 96_003, projectRate], ['trim-start', 44_101, sourceRate],
		['trim-end', 88_197, sourceRate], ['fade-in', 12_345, projectRate], ['fade-out', 1, projectRate],
	] as const) {
		await f.focus(name);
		assert.equal(Math.round(Number(f.input(name).value) * rate), frames, name);
	}
	for (const [name, frames, rate] of [
		['start', 12_345, projectRate], ['length', 24_001, projectRate], ['trim-start', 22_051, sourceRate],
		['trim-end', 11_027, sourceRate], ['fade-in', 2_401, projectRate], ['fade-out', 3_001, projectRate],
		['length', 96_800, projectRate],
	] as const) await f.enter(name, frames / rate);
	assert.deepEqual(f.moves, [['clip', 'track', 12_345, { exactFrame: true }]]);
	assert.deepEqual(f.trims, [
		['clip', { sourceStartFrame: 44_101, sourceDurationFrames: 22_051, durationFrames: 24_001 }],
		['clip', { sourceStartFrame: 22_051, sourceDurationFrames: 110_252, durationFrames: 120_003 }],
		['clip', { sourceStartFrame: 44_101, sourceDurationFrames: 165_372, durationFrames: 179_998 }],
		['clip', { sourceStartFrame: 44_101, sourceDurationFrames: 88_934, durationFrames: 96_800 }],
	]);
	assert.deepEqual(f.updates, [['clip', { fadeInFrames: 2_401 }], ['clip', { fadeOutFrames: 3_001 }]]);
	assert.equal(f.dom.container.querySelectorAll('[data-clip-properties-field="length"]').length, 1);
	assert.equal(f.dom.find('.timecode__format-button'), null);
});

test('locked numeric timing fields keep their values and disable editing', async context => {
	const f = await fixture(context, true);
	for (const name of ['start', 'length', 'trim-start', 'trim-end', 'fade-in', 'fade-out'])
		assert.notEqual(f.input(name).getAttribute('disabled'), null, name);
	assert.equal(f.input('length').value, '2');
});

async function fixture(context: TestContext, locked = false) {
	const dom = installReactTestDom();
	const priorReact = Object.getOwnPropertyDescriptor(globalThis, 'React');
	const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = globals.IS_REACT_ACT_ENVIRONMENT;
	globals.IS_REACT_ACT_ENVIRONMENT = true;
	Object.defineProperty(globalThis, 'React', { configurable: true, value: React });
	const root = createRoot(dom.container as unknown as Element);
	context.after(async () => {
		await act(async () => root.unmount());
		globals.IS_REACT_ACT_ENVIRONMENT = priorAct;
		if (priorReact) Object.defineProperty(globalThis, 'React', priorReact);
		else Reflect.deleteProperty(globalThis, 'React');
		dom.restore();
	});
	const project = createSoundscaperProject({ id: 'dual-clock', sampleRate: projectRate, sources: [source], clips: [clip],
		tracks: [createAudioTrack({ id: 'track', clipIds: [clip.id], locked })] });
	const moves: unknown[][] = [], trims: unknown[][] = [], updates: unknown[][] = [];
	const controller = { actions: { clip: {
		move: (...args: unknown[]) => { moves.push(args); },
		trim: (...args: unknown[]) => { trims.push(args); },
		update: (...args: unknown[]) => { updates.push(args); },
	} } };
	await act(async () => root.render(<ClipPropertiesPanel controller={controller} copy={ENGLISH_COPY} run={operation => operation()}
		snapshot={{ project, selectedClipId: clip.id, capabilities: { audioEffects: false } }} />));
	const field = (name: string) => dom.one(`[data-clip-properties-field="${name}"]`);
	const input = (name: string) => { const node = field(name).querySelector('input'); assert.ok(node); return node; };
	const focus = async (name: string) => {
		input(name).focus();
		await act(async () => reactProps(field(name)).onFocusCapture({ target: input(name) }));
	};
	const enter = async (name: string, seconds: number) => {
		await focus(name);
		await act(async () => reactProps(input(name)).onChange({ target: { value: String(seconds) } }));
		await act(async () => reactProps(field(name)).onBlur({ target: input(name) }));
	};
	return { dom, input, focus, enter, moves, trims, updates };
}
