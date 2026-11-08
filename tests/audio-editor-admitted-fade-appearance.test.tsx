/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { createAudioClip, createAudioSource, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { ClipFadeOverlays } from '../src/common/editor/ui/timeline/ClipFadeOverlays.tsx';
import ClipSourceFades from '../src/common/editor/ui/inspector/ClipSourceFades.tsx';
import { useTimelinePointerStart } from '../src/common/editor/ui/timeline/useTimelinePointerStart.js';
import { presentCapturedClipFadeGesture } from '../src/common/editor/ui/timeline/clip-fade-gesture-presentation.ts';
import { installReactTestDom, reactProps, type ReactTestElement } from './helpers/react-test-dom.ts';

test('admitted native fades present only the owning captured pointer without a corner peek', async () => {
	const fixture = await mount();
	try {
		assert.equal(fixture.listenerCount(), 0, 'idle overlays install no pointer or keyboard listeners');
		assert.equal(fixture.peekCount(), 0);
		await fixture.press();
		const session = fixture.session.current;
		assert.equal(session?.kind, 'fade');
		assert.deepEqual(fixture.captures, [7]);
		assert.equal(fixture.peekCount(), 0, 'hover and drag never draw a preview fade');
		assert.equal(fixture.editing(), true);
		assert.equal(fixture.pressed(), 'true');
		assert.equal(fixture.focused(), false, 'pointer admission does not enter keyboard handle mode');
		await fixture.press({ pointerId: 8 });
		assert.equal(fixture.session.current, session);
		await fixture.end('pointerup', { pointerId: 8 });
		assert.equal(fixture.editing(), true);
		await fixture.end('pointerup', { button: 2 });
		assert.equal(fixture.editing(), true, 'secondary mouse release retains the primary gesture');
		await fixture.end('pointerup');
		assert.equal(fixture.editing(), false);
		assert.equal(fixture.listenerCount(), 0);
	} finally { await fixture.cleanup(); }
});

test('admitted native shape fades present the shape grip and Escape clears their appearance', async () => {
	const fixture = await mount({ shape: true });
	try {
		await fixture.press();
		assert.equal(fixture.session.current?.kind, 'fade-shape');
		assert.equal(fixture.editing(), true);
		assert.deepEqual(fixture.captures, [7]);
		assert.equal(fixture.focused(), false);
		assert.equal(fixture.lengthDrag(), false);
		await fixture.end('keydown', { key: 'Escape' });
		assert.equal(fixture.editing(), false);
		assert.equal(fixture.listenerCount(), 0);
	} finally { await fixture.cleanup(); }
});

for (const type of ['pointercancel', 'lostpointercapture', 'pointermove'] as const) {
	test(`${type} clears only the matching admitted fade appearance`, async () => {
		const fixture = await mount();
		try {
			await fixture.press();
			assert.equal(fixture.editing(), true);
			await fixture.end(type, { pointerId: 8, buttons: 0 });
			assert.equal(fixture.editing(), true);
			await fixture.end(type, { buttons: 0 });
			assert.equal(fixture.editing(), false);
			assert.equal(fixture.listenerCount(), 0);
		} finally { await fixture.cleanup(); }
	});
}

for (const options of [{ blocked: true }, { lockedGroup: true }] as const) {
	test(`native fade appearance requires actual admission and capture ${JSON.stringify(options)}`, async () => {
		const fixture = await mount(options);
		try {
			await fixture.press();
			assert.equal(fixture.editing(), false);
			assert.equal(fixture.listenerCount(), 0);
		} finally { await fixture.cleanup(); }
	});
}

for (const event of [{ button: 2 }, { pointerType: 'touch', isPrimary: false }] as const) {
	test(`rejected pointer press cannot present a fade ${JSON.stringify(event)}`, async () => {
		const fixture = await mount();
		try {
			await fixture.press(event);
			assert.equal(fixture.session.current, null);
			assert.deepEqual(fixture.captures, []);
			assert.equal(fixture.editing(), false);
			assert.equal(fixture.listenerCount(), 0);
		} finally { await fixture.cleanup(); }
	});
}

test('source-monitor fades retain their immediate local presentation path', async () => {
	const fixture = await mount({ sourceMonitor: true });
	try {
		await fixture.press();
		assert.equal(fixture.editing(), true);
		assert.equal(fixture.pressed(), 'true');
		await fixture.end('pointerup');
		assert.equal(fixture.editing(), false);
	} finally { await fixture.cleanup(); }
});

test('blocked rerenders and unmounts retire admitted appearance registrations', async () => {
	const fixture = await mount();
	try {
		await fixture.press();
		assert.equal(fixture.editing(), true);
		await fixture.setBlocked(true);
		assert.equal(fixture.editing(), false);
		assert.equal(fixture.listenerCount(), 0);
		await fixture.unmountOverlay();
		assert.equal(fixture.presentRetired(), false);
		assert.equal(fixture.listenerCount(), 0);
	} finally { await fixture.cleanup(); }
});

interface Options { readonly shape?: boolean; readonly blocked?: boolean; readonly lockedGroup?: boolean; readonly sourceMonitor?: boolean }
interface EventOptions { readonly pointerId?: number; readonly button?: number; readonly buttons?: number; readonly pointerType?: string; readonly isPrimary?: boolean; readonly key?: string }

async function mount(options: Options = {}) {
	const dom = installReactTestDom();
	const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = globals.IS_REACT_ACT_ENVIRONMENT;
	globals.IS_REACT_ACT_ENVIRONMENT = true;
	const events = new EventTarget();
	const listeners = new Map<string, Set<EventListenerOrEventListenerObject>>();
	const documentNode = document as unknown as ReactTestElement;
	Object.assign(documentNode, {
		addEventListener: (type: string, listener: EventListenerOrEventListenerObject) => {
			const entries = listeners.get(type) ?? new Set(); entries.add(listener); listeners.set(type, entries);
			events.addEventListener(type, listener);
		},
		removeEventListener: (type: string, listener: EventListenerOrEventListenerObject) => {
			listeners.get(type)?.delete(listener); events.removeEventListener(type, listener);
		},
	});
	const clip = { ...createAudioClip({ id: 'clip', sourceId: 'source', durationFrames: 48_000,
		fadeInFrames: options.shape ? 12_000 : 0, fadeInShape: 2 }), timelineStartFrame: 0, durationFrames: 48_000 };
	const project = createSoundscaperProject({ id: 'admitted-fade-appearance',
		sources: [createAudioSource({ id: 'source', storageKey: 'source', frameCount: 48_000, sampleRate: 48_000, channelCount: 1 })],
		clips: [clip, createAudioClip({ id: 'other', sourceId: 'source', durationFrames: 48_000 })],
		tracks: [createAudioTrack({ id: 'one', clipIds: ['clip'] }), createAudioTrack({ id: 'two', clipIds: ['other'], locked: options.lockedGroup === true })],
		selection: { startFrame: 0, endFrame: 0, clipIds: options.lockedGroup ? ['clip', 'other'] : [], trackIds: [] },
	});
	const session: { current: Record<string, unknown> | null } = { current: null };
	let blocked = options.blocked === true;
	let showOverlay = true;
	const captures: number[] = [];
	const captured = new Set<number>();
	const noop = () => undefined;
	const rootRef = { current: dom.container as unknown as HTMLDivElement };
	const copy = { fadeIn: 'Fade in', fadeOut: 'Fade out', fadeInShape: 'Fade in shape', fadeOutShape: 'Fade out shape', legacyLinearFadeShape: 'Linear' };
	const root = createRoot(dom.container as unknown as Element);
	function Harness() {
		const { onPointerDown } = useTimelinePointerStart({ controller: {}, snapshot: {}, automationToolEnabled: false,
			showArmControls: false, automationVisibleTrackIds: new Set(), splitToolActive: false, mutationsBlocked: blocked,
			state: { pointerSession: session, touchPointers: { current: new Map() }, pinchSession: { current: null }, scrollRef: { current: null }, setSelectionPreview: noop },
			model: { project, pixelsPerSecond: 200, sampleRate: 48_000 }, hitTesting: { frameAtClientX: noop }, menuActions: { run: noop } });
		return <div data-native-fade-parent onPointerDownCapture={options.sourceMonitor ? undefined : onPointerDown}>
			{showOverlay && (options.sourceMonitor ? <ClipSourceFades rootRef={rootRef} clip={clip} startFrame={0} endFrame={48_000}
				width={200} sampleRate={48_000} blocked={false} copy={copy} onChange={noop} /> : <>
				<div data-clip-id="clip" />
				<ClipFadeOverlays nativePointerAdmission rootRef={rootRef} clips={[clip]} selectedIds={new Set(options.lockedGroup ? ['clip', 'other'] : [])}
					startFrame={0} endFrame={48_000} pixelsPerSecond={200} sampleRate={48_000} blocked={blocked}
					showFadeShapeHandles crossfadedFadeEdges={new Set()} copy={copy} onChange={noop} onTabOut={noop} />
			</>)}
		</div>;
	}
	await act(async () => root.render(<Harness />));
	const handle = dom.one(options.shape ? '[data-clip-fade-shape-handle="in"]' : options.sourceMonitor || options.lockedGroup ? '[data-clip-fade-handle="in"]' : '[data-fade-zone="in"]');
	Object.assign(handle, { setPointerCapture: (id: number) => { captures.push(id); captured.add(id); }, hasPointerCapture: (id: number) => captured.has(id) });
	const overlay = () => dom.one('.audio-editor-clip-fade');
	const originalOwner = overlay() as unknown as HTMLElement;
	return {
		session, captures,
		listenerCount: () => ['pointerup', 'pointercancel', 'lostpointercapture', 'pointermove', 'keydown'].reduce((sum, type) => sum + (listeners.get(type)?.size ?? 0), 0),
		peekCount: () => dom.container.querySelectorAll('[data-fade-peek="in"]').length,
		focused: () => document.activeElement === (handle as unknown as HTMLElement),
		editing: () => overlay().getAttribute('data-fade-editing') === 'true',
		lengthDrag: () => overlay().hasAttribute('data-fade-length-drag'),
		pressed: () => dom.container.querySelectorAll(options.shape ? '[data-clip-fade-shape-handle="in"]' : '[data-clip-fade-handle="in"]')[0]?.getAttribute('data-pressed'),
		setBlocked: (next: boolean) => act(async () => { blocked = next; root.render(<Harness />); }),
		unmountOverlay: () => act(async () => { showOverlay = false; root.render(<Harness />); }),
		presentRetired: () => presentCapturedClipFadeGesture(originalOwner, { target: handle as unknown as HTMLElement, pointerId: 7, clipId: 'clip', edge: 'in', shape: false }),
		press: (fields: EventOptions = {}) => act(async () => {
			let stopped = false;
			const event = { target: handle, currentTarget: dom.one('[data-native-fade-parent]'), pointerId: 7, pointerType: 'mouse', button: 0, buttons: 1,
				isPrimary: true, clientX: 20, clientY: 10, ...fields, preventDefault() {}, stopPropagation() { stopped = true; } };
			reactProps(dom.one('[data-native-fade-parent]')).onPointerDownCapture?.(event);
			if (!stopped) reactProps(overlay()).onPointerDownCapture?.(event);
		}),
		end: (type: string, fields: EventOptions = {}) => act(async () => {
			events.dispatchEvent(Object.assign(new Event(type), { pointerId: 7, pointerType: 'mouse', button: 0, buttons: 1, ...fields }));
		}),
		cleanup: async () => { await act(async () => root.unmount()); assert.equal(['pointerup', 'pointercancel', 'lostpointercapture', 'pointermove', 'keydown'].reduce((sum, type) => sum + (listeners.get(type)?.size ?? 0), 0), 0); globals.IS_REACT_ACT_ENVIRONMENT = priorAct; dom.restore(); },
	};
}
