/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import AudioEditorDialogShell from '../src/common/editor/ui/AudioEditorDialogShell.tsx';
import { installReactTestDom, ReactTestElement } from './helpers/react-test-dom.ts';

interface DialogFixture {
	readonly opener: ReactTestElement;
	readonly outside: ReactTestElement;
	control(selector: string): ReactTestElement;
	open(options?: Readonly<{ modal?: boolean; stacked?: boolean }>): Promise<void>;
	close(): Promise<void>;
	removeOpener(): Promise<void>;
	flushFrames(): Promise<void>;
	pendingFrames(): number;
}

async function withDialog(
	context: TestContext,
	operation: (fixture: DialogFixture) => Promise<void>,
): Promise<void> {
	const dom = installReactTestDom();
	const previousMatches = Object.getOwnPropertyDescriptor(ReactTestElement.prototype, 'matches');
	Object.defineProperty(ReactTestElement.prototype, 'matches', { configurable: true,
		value(this: ReactTestElement, selector: string): boolean {
			return selector === ':disabled' ? this.disabled : this.closest(selector) === this;
		},
	});
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const previousAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	const frames = new Map<number, FrameRequestCallback>();
	let nextFrame = 0;
	context.mock.method(globalThis, 'requestAnimationFrame', (callback: FrameRequestCallback) => {
		const id = ++nextFrame;
		frames.set(id, callback);
		return id;
	});
	context.mock.method(globalThis, 'cancelAnimationFrame', (id: number) => { frames.delete(id); });
	const root = createRoot(dom.container as unknown as HTMLElement);
	const render = async (open: boolean, modal = false, stacked = false, retainOpener = true): Promise<void> => {
		await act(async () => { root.render(<div data-audio-editor>
			{retainOpener && <button type="button" data-opener>Effects</button>}
			<button type="button" data-outside>Effects panel menu</button>
			<AudioEditorDialogShell title="Reverb" isOpen={open} modal={modal}
				initialFocus="[data-first-control]">
				<button type="button" data-first-control>Apply reverb</button>
				<button type="button" data-other-control>Reverb options</button>
			</AudioEditorDialogShell>
			{stacked && <AudioEditorDialogShell title="Effect details" initialFocus="[data-stacked-control]">
				<button type="button" data-stacked-control>Close details</button>
			</AudioEditorDialogShell>}
		</div>); });
	};
	try {
		await render(false);
		const opener = dom.one('[data-opener]');
		opener.focus();
		await operation({
			opener,
			outside: dom.one('[data-outside]'),
			control: selector => dom.one(selector),
			open: options => render(true, options?.modal, options?.stacked),
			close: () => render(false),
			removeOpener: () => render(true, false, false, false),
			async flushFrames() {
				const pending = [...frames.values()];
				frames.clear();
				await act(async () => { for (const callback of pending) callback(0); });
			},
			pendingFrames: () => frames.size,
		});
	} finally {
		await act(async () => { root.unmount(); });
		context.mock.restoreAll();
		if (previousMatches) Object.defineProperty(ReactTestElement.prototype, 'matches', previousMatches);
		else Reflect.deleteProperty(ReactTestElement.prototype, 'matches');
		dom.restore();
		actGlobal.IS_REACT_ACT_ENVIRONMENT = previousAct;
	}
}

test('a nonmodal dialog initially focuses its control while its opener retains focus', async context => {
	await withDialog(context, async fixture => {
		await fixture.open();
		assert.equal(document.activeElement, fixture.opener);
		assert.equal(fixture.pendingFrames(), 1);
		await fixture.flushFrames();
		assert.equal(document.activeElement, fixture.control('[data-first-control]'));
	});
});

test('a nonmodal dialog does not reclaim focus moved to an outside control before its initial frame', async context => {
	await withDialog(context, async fixture => {
		await fixture.open();
		fixture.outside.focus();
		assert.equal(document.activeElement, fixture.outside);
		await fixture.flushFrames();
		assert.equal(document.activeElement, fixture.outside);
	});
});

for (const fallback of ['body', 'documentElement'] as const) {
	test(`a nonmodal dialog takes initial focus after its removed opener leaves ${fallback} focused`, async context => {
		await withDialog(context, async fixture => {
			await fixture.open();
			await fixture.removeOpener();
			assert.equal(fixture.opener.isConnected, false);
			// The layout-free DOM does not implement the browser's removal focus reset.
			document[fallback].focus();
			await fixture.flushFrames();
			assert.equal(document.activeElement, fixture.control('[data-first-control]'));
		});
	});
}

test('a dialog preserves a chosen control inside it before its initial frame', async context => {
	await withDialog(context, async fixture => {
		await fixture.open();
		const chosen = fixture.control('[data-other-control]');
		chosen.focus();
		await fixture.flushFrames();
		assert.equal(document.activeElement, chosen);
	});
});

test('a modal dialog still takes initial focus after focus moves outside it', async context => {
	await withDialog(context, async fixture => {
		await fixture.open({ modal: true });
		fixture.outside.focus();
		await fixture.flushFrames();
		assert.equal(document.activeElement, fixture.control('[data-first-control]'));
	});
});

test('only the newest modal dialog takes initial focus when their frames are pending together', async context => {
	await withDialog(context, async fixture => {
		await fixture.open({ modal: true, stacked: true });
		assert.equal(fixture.pendingFrames(), 2);
		await fixture.flushFrames();
		assert.equal(document.activeElement, fixture.control('[data-stacked-control]'));
	});
});

test('closing a dialog cancels its pending initial focus frame', async context => {
	await withDialog(context, async fixture => {
		await fixture.open();
		assert.equal(fixture.pendingFrames(), 1);
		await fixture.close();
		assert.equal(fixture.pendingFrames(), 0);
		fixture.outside.focus();
		await fixture.flushFrames();
		assert.equal(document.activeElement, fixture.outside);
	});
});
