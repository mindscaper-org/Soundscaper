/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { EnvelopeInteractionLayer, type EnvelopePoint } from '../vendor/audacity-design-system/components/src/EnvelopeInteractionLayer/EnvelopeInteractionLayer.tsx';
import { useAudioTrackEnvelope } from '../src/common/editor/ui/timeline/useAudioTrackEnvelope.js';
import { envelopeFramesToDesignPoints } from '../src/common/editor/automation.js';
import { resolveRuntimeProjectProjection } from '../src/common/editor/runtime-clip-projection.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createSoundscaperProjectHistory, executeSoundscaperProjectCommand, undoSoundscaperProjectCommand } from '../src/soundscaper/editor-project-history.ts';
import { createAudioClip, createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

for (const existingPoint of [false, true]) for (const release of ['mouseup', 'blur', 'lost primary'] as const) {
	test(`clip-gain ${existingPoint ? 'point' : 'segment'} completes once after ${release}`, async context => {
		await withEnvelope(context, existingPoint, async f => {
			await f.begin();
			await f.move(12, 1);
			assert.equal(f.updates(), 0, 'the held preview stays out of history');
			const intended = f.displayed();
			assert.ok(intended.every(point => point.db < 0));
			await f.release(release);
			assert.equal(f.updates(), 1, 'the last intended preview becomes one undoable edit');
			assertPointsClose(f.displayed(), intended);
			await f.move(-25, 0);
			await f.release('mouseup');
			assert.equal(f.updates(), 1, 'an unrelated release cannot publish hovering changes');
			assertPointsClose(f.displayed(), intended);
			await f.undo();
			assert.deepEqual(f.envelope(), existingPoint ? [{ frame: 24_000, value: 1 }] : []);
			await f.begin(); await f.move(18, 1); await f.release('mouseup');
			assert.equal(f.updates(), 2, 'a fresh drag still works after the retired gesture');
		});
	});
}

for (const auxiliary of [1, 2]) test(`clip gain retains the primary drag through auxiliary release ${auxiliary}`, async context => {
	await withEnvelope(context, true, async f => {
		await f.begin(); await f.move(8, 1);
		await f.dispatch('mouseup', { button: auxiliary, buttons: 1 });
		assert.equal(f.updates(), 0);
		const previous = f.displayed();
		await f.move(18, 1);
		assert.notDeepEqual(f.displayed(), previous, 'rerendering a held preview does not end its gesture');
		await f.release('mouseup');
		assert.equal(f.updates(), 1);
	});
});

test('Escape cancellation stays unpublished through blur and a missing-release move', async context => {
	await withEnvelope(context, true, async f => {
		await f.begin(); await f.move(12, 1);
		await f.dispatch('keydown', { key: 'Escape' });
		await f.release('blur'); await f.move(-25, 0); await f.release('mouseup');
		assert.equal(f.updates(), 0);
		assert.deepEqual(f.envelope(), [{ frame: 24_000, value: 1 }]);
	});
});

test('a replacement authored envelope retires the old preview before outside completion', async context => {
	await withEnvelope(context, true, async f => {
		await f.begin(); await f.move(12, 1);
		await f.replaceEnvelope();
		await f.release('blur'); await f.move(-25, 0); await f.release('mouseup');
		assert.equal(f.updates(), 0);
		assert.deepEqual(f.envelope(), [{ frame: 24_000, value: .5 }]);
	});
});

type Release = 'mouseup' | 'blur' | 'lost primary';
function assertPointsClose(actual: readonly EnvelopePoint[], expected: readonly EnvelopePoint[]) {
	assert.equal(actual.length, expected.length);
	actual.forEach((point, index) => {
		assert.equal(point.time, expected[index]!.time);
		assert.ok(Math.abs(point.db - expected[index]!.db) < 1e-10, 'linear-gain publication preserves the intended level');
	});
}
interface Fixture {
	begin(): Promise<void>;
	move(delta: number, buttons: number): Promise<void>;
	release(release: Release): Promise<void>;
	dispatch(type: string, values: Readonly<Record<string, unknown>>): Promise<void>;
	undo(): Promise<void>;
	replaceEnvelope(): Promise<void>;
	updates(): number;
	displayed(): EnvelopePoint[];
	envelope(): unknown;
}

async function withEnvelope(context: TestContext, existingPoint: boolean, run: (f: Fixture) => Promise<void>) {
	context.mock.timers.enable({ apis: ['setTimeout'] });
	const dom = installReactTestDom();
	const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = globals.IS_REACT_ACT_ENVIRONMENT; globals.IS_REACT_ACT_ENVIRONMENT = true;
	const document = dom.container.ownerDocument as unknown as Document;
	type Listeners = Map<string, Map<EventListenerOrEventListenerObject, boolean>>;
	const listeners: Listeners = new Map(), windowListeners: Listeners = new Map();
	for (const [target, entries] of [[document, listeners], [window, windowListeners]] as const) {
		target.addEventListener = (type: string, listener: EventListenerOrEventListenerObject | null, options?: boolean | AddEventListenerOptions) => {
			if (!listener) return;
			const callbacks = entries.get(type) ?? new Map();
			callbacks.set(listener, typeof options === 'boolean' ? options : options?.capture === true);
			entries.set(type, callbacks);
		};
		target.removeEventListener = (type: string, listener: EventListenerOrEventListenerObject | null) => { if (listener) entries.get(type)?.delete(listener); };
	}
	let history = createSoundscaperProjectHistory(createSoundscaperProject({ id: 'envelope-outside-release', sampleRate: 48_000,
		sources: [createAudioSource({ id: 'source', frameCount: 48_000, sampleRate: 48_000, channelCount: 1 })],
		tracks: [createAudioTrack({ id: 'track', clipIds: ['clip'] })],
		clips: [createAudioClip({ id: 'clip', sourceId: 'source', durationFrames: 48_000,
			envelope: existingPoint ? [{ frame: 24_000, value: 1 }] : [] })] }));
	let updates = 0, displayed: EnvelopePoint[] = [];
	const root = createRoot(dom.container as unknown as Element);
	const controller = { actions: { clip: { update(id: string, changes: Record<string, unknown>) {
		history = executeSoundscaperProjectCommand(history, { type: 'clip/update', clipId: id, changes });
		updates += 1; render();
	} } } };
	const render = () => root.render(<Harness project={resolveRuntimeProjectProjection(history.present)} />);
	function Harness({ project }: { readonly project: ReturnType<typeof resolveRuntimeProjectProjection> }) {
		const clip = project.clips[0]!;
		if (clip.kind !== 'audio') throw new Error('The fixture owns an ordinary audio clip.');
		const { updateEnvelope, envelopePreviewRef } = useAudioTrackEnvelope({ controller, run: (operation: () => unknown) => operation(),
			blocked: false, automationToolEnabled: true, clipLookup: new Map([[clip.id, clip]]),
			projectionClips: [{ ...clip, waveformStartFrame: 0, waveformEndFrame: 48_000 }], sampleRate: 48_000 });
		displayed = envelopePreviewRef.current.get(clip.id)?.designPoints ?? envelopeFramesToDesignPoints(clip.envelope, 48_000);
		return <div data-envelope-harness><EnvelopeInteractionLayer envelopePoints={displayed}
			onEnvelopePointsChange={next => updateEnvelope(clip.id, next)} enabled width={100} height={100} duration={1} /></div>;
	}
	const dispatch = async (type: string, values: Readonly<Record<string, unknown>>, entries = listeners) => {
		await act(async () => {
			const event = Object.assign(new Event(type, { cancelable: true }), values);
			for (const capture of [true, false]) for (const [listener, isCapture] of [...entries.get(type) ?? []]) {
				if (isCapture !== capture) continue;
				if (typeof listener === 'function') listener(event); else listener.handleEvent(event);
			}
			context.mock.timers.runAll();
		});
	};
	const y = 97 * (1 - (5 / 6) ** 3);
	try {
		await act(async () => { render(); });
		const surface = dom.one('[data-envelope-harness]').querySelector('div'); assert.ok(surface);
		(surface as unknown as { getBoundingClientRect(): object }).getBoundingClientRect = () => ({ left: 0, top: 0, width: 100, height: 100 });
		await run({ updates: () => updates, displayed: () => structuredClone(displayed), envelope: () => history.present.clips[0]!.envelope,
			begin: async () => { await act(async () => { reactProps(surface).onMouseDown({ button: 0, clientX: 50, clientY: y, stopPropagation() {} }); }); },
			move: async (delta, buttons) => { await dispatch('mousemove', { button: 0, buttons, clientX: 50, clientY: y + delta }); },
			release: async release => {
				if (release === 'blur') await dispatch('blur', {}, windowListeners);
				else if (release === 'lost primary') await dispatch('mousemove', { button: 0, buttons: 0, clientX: 50, clientY: y - 25 });
				else await dispatch('mouseup', { button: 0, buttons: 0 });
			}, dispatch,
			undo: async () => { await act(async () => { history = undoSoundscaperProjectCommand(history); render(); }); },
			replaceEnvelope: async () => { await act(async () => {
				history = executeSoundscaperProjectCommand(history, { type: 'clip/update', clipId: 'clip', changes: { envelope: [{ frame: 24_000, value: .5 }] } }); render();
			}); },
		});
	} finally {
		await act(async () => { root.unmount(); context.mock.timers.runAll(); });
		for (const type of ['mousedown', 'mousemove', 'mouseup', 'keydown', 'blur']) {
			assert.equal((listeners.get(type)?.size ?? 0) + (windowListeners.get(type)?.size ?? 0), 0, `${type} gesture listeners are released`);
		}
		globals.IS_REACT_ACT_ENVIRONMENT = priorAct; dom.restore();
	}
}
