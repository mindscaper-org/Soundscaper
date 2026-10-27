/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { ClipFadeOverlays } from '../src/common/editor/ui/timeline/ClipFadeOverlays.tsx';
import { presentCapturedClipFadeGesture } from '../src/common/editor/ui/timeline/clip-fade-gesture-presentation.ts';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

test('unselected audio clips expose corner zones and a bare-edge peek without selecting the clip', async context => {
	const dom = installReactTestDom();
	const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const previous = globals.IS_REACT_ACT_ENVIRONMENT;
	globals.IS_REACT_ACT_ENVIRONMENT = true;
	const root = createRoot(dom.container as unknown as Element);
	const document = dom.container.ownerDocument as unknown as Document;
	const listeners = new Map<string, Set<EventListener>>();
	const add = document.addEventListener.bind(document), remove = document.removeEventListener.bind(document);
	document.addEventListener = ((name: string, listener: EventListener, capture?: boolean) => {
		if (capture === true) { const group = listeners.get(name) ?? new Set<EventListener>(); group.add(listener); listeners.set(name, group); }
		add(name, listener, capture);
	}) as Document['addEventListener'];
	document.removeEventListener = ((name: string, listener: EventListener, capture?: boolean) => {
		if (capture === true) listeners.get(name)?.delete(listener);
		remove(name, listener, capture);
	}) as Document['removeEventListener'];
	const capture = async (name: string, event: Readonly<Record<string, unknown>>) => act(async () => {
		for (const listener of [...listeners.get(name) ?? []]) listener({ type: name, ...event } as unknown as Event);
	});
	context.after(async () => { await act(async () => root.unmount()); globals.IS_REACT_ACT_ENVIRONMENT = previous; dom.restore(); });
	const clip = { id: 'one', kind: 'audio', timelineStartFrame: 0, durationFrames: 48_000, fadeOutFrames: 12_000 };
	const rootRef = { current: dom.container as unknown as HTMLDivElement };
	const changes: unknown[] = [];
	const render = async (selected: boolean) => act(async () => root.render(<><div data-clip-id="one" />
		<ClipFadeOverlays nativePointerAdmission rootRef={rootRef} clips={[clip]} selectedIds={new Set(selected ? ['one'] : [])}
			startFrame={0} endFrame={48_000} pixelsPerSecond={200} sampleRate={48_000} blocked={false}
			showFadeShapeHandles crossfadedFadeEdges={new Set()}
			copy={{ fadeIn: 'Fade in', fadeOut: 'Fade out', fadeInShape: 'Fade in shape', fadeOutShape: 'Fade out shape', legacyLinearFadeShape: 'Linear' }}
			onChange={(...args) => changes.push(args)} onTabOut={() => {}} /></>));
	await render(false);
	const zone = dom.one('[data-fade-zone="in"]');
	assert.equal(zone.getAttribute('data-clip-fade-handle'), 'in', 'the corner uses the native fade gesture');
	assert.equal((zone.style as unknown as CSSStyleDeclaration).left, '-16px');
	assert.equal((dom.one('[data-fade-zone="out"]').style as unknown as CSSStyleDeclaration).left, '134px', 'an existing fade owns its boundary');
	await act(async () => reactProps(zone).onMouseEnter({ buttons: 0 }));
	assert.equal(dom.one('[data-fade-peek="in"]').getAttribute('aria-hidden'), 'true');
	assert.deepEqual(changes, [], 'hover is a preview only');
	assert.equal(listeners.size, 0, 'idle overlays defer pointer admission to the native timeline');
	const owner = dom.one('.audio-editor-clip-fade') as unknown as HTMLElement;
	const present = (target: typeof zone | HTMLElement, pointerId: number) => presentCapturedClipFadeGesture(owner, {
		target: target as HTMLElement, pointerId, clipId: 'one', edge: 'in', shape: false,
	});
	const foreign = document.createElement('div');
	foreign.dataset.clipFadeHandle = 'in';
	assert.equal(present(foreign, 99), false);
	assert.equal(dom.find('[data-fade-length-drag]'), null, 'another row cannot arm this overlay');
	assert.equal(present(zone, 7), false, 'presentation requires native pointer capture');
	Object.assign(zone, { hasPointerCapture: (id: number) => id === 7 });
	await act(async () => { assert.equal(present(zone, 7), true); });
	assert.equal(dom.one('.audio-editor-clip-fade').getAttribute('data-fade-length-drag'), '');
	assert.equal(dom.find('[data-fade-peek="in"]'), null, 'a press retires the hover preview');
	await capture('pointerup', { pointerId: 99, pointerType: 'mouse', button: 0 });
	await capture('pointerup', { pointerId: 7, pointerType: 'mouse', button: 1 });
	assert.ok(dom.find('[data-fade-length-drag]'), 'foreign pointers and auxiliary releases do not end the drag');
	await capture('pointerup', { pointerId: 7, pointerType: 'mouse', button: 0 });
	assert.equal(dom.find('[data-fade-length-drag]'), null);
	assert.deepEqual(changes, [], 'presentation never commits edits owned by the native timeline');
	await render(true);
	assert.equal(dom.container.querySelectorAll('[data-fade-zone]').length, 0);
	assert.equal(dom.one('.audio-editor-clip-fade').getAttribute('data-fade-selected'), 'true');
});
