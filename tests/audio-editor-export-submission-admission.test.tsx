/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { ExportDialog } from '../src/common/editor/ui/inspector/ExportDialog.jsx';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { deferred } from './helpers/async-test-control.ts';
import { installReactTestDom, reactProps, ReactTestElement } from './helpers/react-test-dom.ts';

test('cold export immediately locks its settings and refuses a second offered activation', async () => {
	const f = await fixture();
	try {
		const activate = reactProps(f.startButton()).onClick;
		await act(async () => { activate({}); activate({}); });
		assert.equal(f.requests.length, 1);
		assert.equal(f.startButton().hasAttribute('disabled'), true);
		assert.equal(f.sampleRate().hasAttribute('disabled'), true);
		assert.equal(f.button('Metadata').hasAttribute('disabled'), true);
		assert.equal(f.button('Cancel').hasAttribute('disabled'), false);
		await f.settle(0);
		assert.equal(f.startButton().hasAttribute('disabled'), false);
		assert.equal(f.sampleRate().hasAttribute('disabled'), false);
		await f.changeRate('24000');
		await f.start();
		assert.equal(f.requests[1]?.sampleRate, 24000);
		await f.settle(1);
	} finally { await f.unmount(); }
});

test('a failed cold export unlocks the existing draft for a corrected retry', async () => {
	const f = await fixture();
	try {
		await f.start();
		await f.settle(0, new Error('Encoder could not load.'));
		assert.ok(f.dom.container.textContent.includes('Encoder could not load.'));
		assert.equal(f.startButton().hasAttribute('disabled'), false);
		assert.equal(f.sampleRate().hasAttribute('disabled'), false);
		await f.changeRate('24000');
		await f.start();
		assert.equal(f.requests[1]?.sampleRate, 24000);
		assert.equal(f.dom.container.textContent.includes('Encoder could not load.'), false);
		await f.settle(1);
	} finally { await f.unmount(); }
});

test('a synchronous exporter refusal releases admission for a retry', async () => {
	const f = await fixture();
	try {
		f.refuseNext();
		await f.start();
		assert.ok(f.dom.container.textContent.includes('Export refused.'));
		assert.equal(f.startButton().hasAttribute('disabled'), false);
		assert.equal(f.sampleRate().hasAttribute('disabled'), false);
		await f.start();
		assert.equal(f.requests.length, 1);
		await f.settle(0);
	} finally { await f.unmount(); }
});

test('cold Cancel remains available and an obsolete completion cannot unlock the reopened submission', async () => {
	const f = await fixture();
	try {
		await f.start();
		await f.click(f.button('Cancel'));
		assert.equal(f.canceled(), 1);
		assert.equal(f.closed(), 1);
		await f.render({ open: false });
		await f.render({ open: true });
		await f.changeRate('24000');
		await f.start();
		await f.settle(0, new Error('Canceled export failed late.'));
		assert.equal(f.startButton().hasAttribute('disabled'), true);
		assert.equal(f.dom.container.textContent.includes('Canceled export failed late.'), false);
		await f.settle(1);
		assert.equal(f.startButton().hasAttribute('disabled'), false);
	} finally { await f.unmount(); }
});

test('a project switch admits its own export without accepting an older completion', async () => {
	const f = await fixture();
	try {
		await f.start();
		await f.render({ projectId: 'second-project' });
		assert.equal(f.sampleRate().hasAttribute('disabled'), false);
		await f.start();
		await f.settle(0, new Error('First project failed late.'));
		assert.equal(f.startButton().hasAttribute('disabled'), true);
		assert.equal(f.dom.container.textContent.includes('First project failed late.'), false);
		await f.settle(1);
		assert.equal(f.startButton().hasAttribute('disabled'), false);
	} finally { await f.unmount(); }
});

test('warm exporter ownership retains its existing Cancel Export action after local submission settles', async () => {
	const f = await fixture();
	try {
		await f.start();
		await f.render({ exporting: true });
		await f.settle(0);
		assert.equal(f.sampleRate().hasAttribute('disabled'), true);
		await f.click(f.button(ENGLISH_COPY.cancelExport));
		assert.equal(f.canceled(), 1);
		assert.equal(f.closed(), 0);
		await f.render({ exporting: false });
		assert.equal(f.startButton().hasAttribute('disabled'), false);
	} finally { await f.unmount(); }
});

async function fixture() {
	const dom = installReactTestDom();
	const actGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = actGlobal.IS_REACT_ACT_ENVIRONMENT;
	const priorReact = Object.getOwnPropertyDescriptor(globalThis, 'React');
	actGlobal.IS_REACT_ACT_ENVIRONMENT = true;
	Object.defineProperty(globalThis, 'React', { configurable: true, value: React });
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	const requests: Readonly<Record<string, unknown>>[] = [];
	const pending: ReturnType<typeof deferred<void>>[] = [];
	let cancelCount = 0, closeCount = 0, refuseNext = false;
	let view = { projectId: 'first-project', open: true, exporting: false };
	const controller = {
		subscribeTelemetry: () => () => undefined,
		getTelemetrySnapshot: () => ({ exportProgress: 0 }),
		actions: { export: {
			presets: { list: () => [] },
			previewDeliveryCanvas: () => undefined,
			start: (request: Readonly<Record<string, unknown>>) => {
				if (refuseNext) { refuseNext = false; throw new Error('Export refused.'); }
				requests.push(request);
				const operation = deferred<void>();
				pending.push(operation);
				return operation.promise;
			},
			cancel: () => { cancelCount++; },
		} },
	};
	const render = async (patch: Partial<typeof view> = {}) => {
		view = { ...view, ...patch };
		await act(async () => root.render(<ExportDialog isOpen={view.open} controller={controller}
			snapshot={{ ready: true, importing: false, recording: false, processingEffect: false,
				exporting: view.exporting, export: { progress: 0, output: null },
				masteringSequences: { sequences: [] }, project: { id: view.projectId, revision: 1,
					title: 'Export admission', sampleRate: 48000, masterChannels: 2, metadata: {},
					clips: [{ id: 'clip', kind: 'audio' }], tracks: [{ id: 'track', type: 'audio', clipIds: ['clip'] }] } }}
			copy={ENGLISH_COPY} productId="soundscaper" fileService={{ isDesktop: false }}
			onClose={() => { closeCount++; }} />));
	};
	await render();
	const button = (label: string) => {
		const node = descendants(dom.container).find(node => node.tagName === 'BUTTON' && node.textContent === label);
		assert.ok(node, `Missing button ${label}.`);
		return node;
	};
	const startButton = () => descendantByTag(dom.one('[data-export-action="start"]'), 'BUTTON');
	const sampleRate = () => descendantByTag(dom.one('[data-export-field="sampleRate"]'), 'INPUT');
	const click = async (node: ReactTestElement) => { await act(async () => { reactProps(node).onClick({}); }); };
	return {
		dom, requests, render, button, startButton, sampleRate, click,
		refuseNext: () => { refuseNext = true; },
		start: () => click(startButton()),
		canceled: () => cancelCount,
		closed: () => closeCount,
		async changeRate(value: string) {
			await act(async () => { reactProps(sampleRate()).onChange({ currentTarget: { value } }); });
		},
		async settle(index: number, error?: Error) {
			const operation = pending[index];
			assert.ok(operation);
			await act(async () => {
				if (error) operation.reject(error); else operation.resolve();
				await operation.promise.catch(() => undefined);
			});
		},
		async unmount() {
			await act(async () => root.unmount());
			for (const operation of pending) operation.resolve();
			actGlobal.IS_REACT_ACT_ENVIRONMENT = priorAct;
			if (priorReact) Object.defineProperty(globalThis, 'React', priorReact);
			else Reflect.deleteProperty(globalThis, 'React');
			dom.restore();
		},
	};
}

function descendants(root: ReactTestElement): ReactTestElement[] {
	const elements: ReactTestElement[] = [];
	const visit = (node: ReactTestElement) => {
		for (const child of node.childNodes) if (child instanceof ReactTestElement) {
			elements.push(child);
			visit(child);
		}
	};
	visit(root);
	return elements;
}
function descendantByTag(root: ReactTestElement, tag: string): ReactTestElement {
	const element = descendants(root).find(node => node.tagName === tag);
	assert.ok(element, `Missing ${tag}.`);
	return element;
}
