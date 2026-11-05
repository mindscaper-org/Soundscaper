/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import type { JSHandle, Page } from '@playwright/test';
import { withMotionQualificationActivation } from '../desktop/motionscaper-qualification-activation.ts';

function browser() {
	const attributes = new Map<string, string>([['data-audio-editor-bound', 'true'], ['data-project-id', 'linked-project']]);
	const editor = { isConnected: true, getAttribute: (name: string) => attributes.get(name) ?? null };
	let selected: typeof editor | null = editor, callback: MutationCallback | undefined, observing = false;
	let disposed = 0, disconnected = 0, waited = 0, resultDisposed = 0;
	let waitError: Error | undefined, cleanupError: Error | undefined;
	let beforeWait: (() => void) | undefined;
	const records: MutationRecord[] = [];
	class Observer {
		constructor(next: MutationCallback) { callback = next; }
		observe(_target: unknown, options: MutationObserverInit) {
			assert.equal(options.attributeOldValue, true); assert.equal(options.subtree, true); observing = true;
		}
		disconnect() { observing = false; disconnected++; }
	}
	function inBrowser<Value>(action: () => Value): Value {
		const values = { document: { querySelectorAll: () => selected ? [selected] : [] }, MutationObserver: Observer };
		const previous = Object.entries(values).map(([key, value]) => {
			const descriptor = Object.getOwnPropertyDescriptor(globalThis, key);
			Object.defineProperty(globalThis, key, { configurable: true, value }); return [key, descriptor] as const;
		});
		try { return action(); } finally {
			for (const [key, descriptor] of previous) {
				if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key);
			}
		}
	}
	let state: unknown;
	const page = {
		evaluateHandle(action: () => unknown) {
			state = inBrowser(action);
			return Promise.resolve({
				evaluate: (action: (value: unknown) => unknown) => {
					if (cleanupError) return Promise.reject(cleanupError);
					return Promise.resolve(inBrowser(() => action(state)));
				},
				dispose: () => { disposed++; return Promise.resolve(); },
			} as unknown as JSHandle);
		},
		waitForFunction(action: (value: unknown) => unknown, _handle: JSHandle, options: { timeout: number }) {
			waited++; assert.equal(options.timeout, 10000);
			if (waitError) return Promise.reject(waitError);
			beforeWait?.();
			if (!inBrowser(() => action(state))) return Promise.reject(new Error('The expected activation cycle did not complete.'));
			return Promise.resolve({ dispose: () => { resultDisposed++; return Promise.resolve(); } });
		},
	} as unknown as Pick<Page, 'evaluateHandle' | 'waitForFunction'>;
	return {
		page, attributes,
		get observing() { return observing; },
		get counts() { return { disposed, disconnected, waited, resultDisposed }; },
		set waitError(value: Error) { waitError = value; },
		set cleanupError(value: Error) { cleanupError = value; },
		set beforeWait(value: () => void) { beforeWait = value; },
		pending(value: boolean) {
			const name = 'data-project-activation-pending', oldValue = editor.getAttribute(name);
			if (value) attributes.set(name, 'true'); else attributes.delete(name);
			records.push({ target: editor, attributeName: name, oldValue } as unknown as MutationRecord);
		},
		project(value: string) {
			const attributeName = 'data-project-id', oldValue = editor.getAttribute(attributeName);
			attributes.set(attributeName, value);
			records.push({ target: editor, attributeName, oldValue } as unknown as MutationRecord);
		},
		detachAndReinsert() {
			records.push({ type: 'childList', removedNodes: [editor] } as unknown as MutationRecord);
		},
		flush() { inBrowser(() => callback?.(records.splice(0), {} as MutationObserver)); },
		replace() { selected = { ...editor }; },
		remove() { selected = null; editor.isConnected = false; },
	};
}

test('The activation fence subscribes before publication and retires its observation before returning the receipt', async () => {
	const fixture = browser(), receipt = { digest: 'next-saved-revision' };
	const actual = await withMotionQualificationActivation(fixture.page, async () => {
		assert.equal(fixture.observing, true); fixture.pending(true); fixture.flush();
		fixture.pending(false); fixture.flush(); return receipt;
	});
	assert.equal(actual, receipt); assert.equal(fixture.observing, false);
	assert.deepEqual(fixture.counts, { disposed: 1, disconnected: 1, waited: 1, resultDisposed: 1 });
});

test('The activation fence retains a complete fast cycle delivered in one MutationObserver batch during publication', async () => {
	const fixture = browser();
	await withMotionQualificationActivation(fixture.page, async () => {
		fixture.pending(true); fixture.pending(false); fixture.flush(); return 'published';
	});
	assert.equal(fixture.counts.waited, 1); assert.equal(fixture.counts.disconnected, 1);
});

test('Publication returning while idle still waits for the next activation cycle', async () => {
	const fixture = browser(); let published = false;
	fixture.beforeWait = () => {
		assert.equal(published, true); assert.equal(fixture.observing, true);
		fixture.pending(true); fixture.flush(); fixture.pending(false); fixture.flush();
	};
	assert.equal(await withMotionQualificationActivation(fixture.page, async () => { published = true; return 'next'; }), 'next');
	assert.equal(fixture.counts.waited, 1);
});

for (const absent of ['editor', 'project'] as const) {
	test(`The activation fence refuses publication without the current ${absent}`, async () => {
		const fixture = browser(); let published = false;
		if (absent === 'editor') fixture.remove(); else fixture.attributes.delete('data-project-id');
		await assert.rejects(withMotionQualificationActivation(fixture.page, async () => { published = true; }), /requires/iu);
		assert.equal(published, false); assert.equal(fixture.observing, false);
	});
}

for (const transition of ['none', 'pending-only'] as const) {
	test(`The activation fence refuses an idle sample without a complete next cycle: ${transition}`, async () => {
		const fixture = browser();
		await assert.rejects(withMotionQualificationActivation(fixture.page, async () => {
			if (transition === 'pending-only') { fixture.pending(true); fixture.flush(); } return 'published';
		}), /expected activation cycle/u);
		assert.equal(fixture.observing, false); assert.equal(fixture.counts.disposed, 1);
	});
}

for (const change of ['replace', 'remove', 'owner'] as const) {
	test(`The activation fence refuses a cycle after the linked project root changes: ${change}`, async () => {
		const fixture = browser();
		await assert.rejects(withMotionQualificationActivation(fixture.page, async () => {
			fixture.pending(true); fixture.flush();
			if (change === 'owner') fixture.attributes.set('data-project-id', 'another-project'); else fixture[change]();
			fixture.pending(false); fixture.flush(); return 'published';
		}), /project.*changed/iu);
		assert.equal(fixture.counts.disconnected, 1);
	});
}

test('The activation fence rejects project owner retirement within one observer batch', async () => {
	const fixture = browser();
	await assert.rejects(withMotionQualificationActivation(fixture.page, async () => {
		fixture.pending(true); fixture.project('another-project'); fixture.project('linked-project');
		fixture.pending(false); fixture.flush(); return 'published';
	}), /project.*changed/iu);
	assert.equal(fixture.counts.disconnected, 1); assert.equal(fixture.counts.disposed, 1);
});

test('The activation fence rejects editor root retirement within one observer batch', async () => {
	const fixture = browser();
	await assert.rejects(withMotionQualificationActivation(fixture.page, async () => {
		fixture.pending(true); fixture.detachAndReinsert(); fixture.pending(false); fixture.flush(); return 'published';
	}), /project.*changed/iu);
	assert.equal(fixture.counts.disconnected, 1); assert.equal(fixture.counts.disposed, 1);
});

test('An already pending activation cannot be mistaken for the next saved revision', async () => {
	const fixture = browser(); fixture.attributes.set('data-project-activation-pending', 'true'); let published = false;
	await assert.rejects(withMotionQualificationActivation(fixture.page, async () => { published = true; }), /already pending/iu);
	assert.equal(published, false);
});

test('Publication failure remains primary and always disconnects the observation', async () => {
	const fixture = browser(), failure = new Error('publisher failed');
	await assert.rejects(withMotionQualificationActivation(fixture.page, () => Promise.reject(failure)), error => error === failure);
	assert.deepEqual(fixture.counts, { disposed: 1, disconnected: 1, waited: 0, resultDisposed: 0 });
});

test('Activation wait failure preserves the error and disconnects the observation', async () => {
	const fixture = browser(), failure = new Error('activation timed out'); fixture.waitError = failure;
	await assert.rejects(withMotionQualificationActivation(fixture.page, async () => 'published'), error => error === failure);
	assert.equal(fixture.counts.disconnected, 1); assert.equal(fixture.counts.disposed, 1);
});

test('Cleanup failure retains the publisher error and still releases the remote handle', async () => {
	const fixture = browser(), failure = new Error('publisher failed'), cleanup = new Error('page retired'); fixture.cleanupError = cleanup;
	await assert.rejects(withMotionQualificationActivation(fixture.page, () => Promise.reject(failure)), error => {
		assert.ok(error instanceof AggregateError); assert.deepEqual(error.errors, [failure, cleanup]); return true;
	});
	assert.equal(fixture.counts.disposed, 1);
});
