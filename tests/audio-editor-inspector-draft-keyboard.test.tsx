/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { CommitField } from '../src/common/editor/ui/inspector/inspector-controls.jsx';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';
import { deferred } from './helpers/async-test-control.ts';

(globalThis as unknown as { React: unknown }).React = React;

test('inspector draft keyboard submission commits once and Escape cancels the pending blur', async () => {
	const dom = installReactTestDom();
	const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = globals.IS_REACT_ACT_ENVIRONMENT;
	globals.IS_REACT_ACT_ENVIRONMENT = true;
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	const committed: string[] = [];
	try {
		await act(async () => root.render(<CommitField label="Clip name" name="name" value="Tone"
			disabled={false} readOnly={false} multiline={false} onCommit={(_name: string, value: string) => { committed.push(value); }} />));
		const field = dom.one('input');
		const wrapper = dom.one('label');
		let blurCount = 0;
		const target = { blur() { blurCount += 1; reactProps(field).onBlur(); } };
		const keyboard = (key: string) => ({ key, target, preventDefault() {}, stopPropagation() {} });
		await act(async () => reactProps(field).onChange({ target: { value: 'Opening tone' } }));
		await act(async () => reactProps(wrapper).onKeyDown(keyboard('Enter')));
		assert.equal(blurCount, 1);
		assert.deepEqual(committed, ['Opening tone']);
		await act(async () => reactProps(field).onChange({ target: { value: 'Discard this title' } }));
		await act(async () => reactProps(wrapper).onKeyDown(keyboard('Escape')));
		assert.equal(field.value, 'Tone');
		assert.equal(blurCount, 2);
		assert.deepEqual(committed, ['Opening tone']);
		await act(async () => reactProps(field).onChange({ target: { value: 'Later title' } }));
		await act(async () => reactProps(field).onBlur());
		assert.deepEqual(committed, ['Opening tone', 'Later title']);
	} finally {
		await act(async () => root.unmount());
		globals.IS_REACT_ACT_ENVIRONMENT = priorAct;
		dom.restore();
	}
});

test('a rejected inspector commit reports its invalid field state', async () => {
	const dom = installReactTestDom();
	const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = globals.IS_REACT_ACT_ENVIRONMENT;
	globals.IS_REACT_ACT_ENVIRONMENT = true;
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	try {
		await act(async () => root.render(<CommitField label="Gain" name="gain" value="0"
			disabled={false} readOnly={false} multiline={false} onCommit={(_name: string, value: string) => Number(value) <= 16} />));
		const field = dom.one('input');
		await act(async () => reactProps(field).onChange({ target: { value: '25' } }));
		await act(async () => reactProps(field).onBlur());
		assert.equal(field.getAttribute('aria-invalid'), 'true');
		await act(async () => reactProps(field).onChange({ target: { value: '-6' } }));
		await act(async () => reactProps(field).onBlur());
		assert.equal(field.getAttribute('aria-invalid'), null);
	} finally {
		await act(async () => root.unmount());
		globals.IS_REACT_ACT_ENVIRONMENT = priorAct;
		dom.restore();
	}
});

async function mountDeferredField(context: test.TestContext) {
	const dom = installReactTestDom();
	const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = globals.IS_REACT_ACT_ENVIRONMENT;
	globals.IS_REACT_ACT_ENVIRONMENT = true;
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	context.after(async () => {
		try { await act(async () => root.unmount()); }
		finally { globals.IS_REACT_ACT_ENVIRONMENT = priorAct; dom.restore(); }
	});
	const committed: Array<{ name: string; value: string }> = [];
	const render = (value: string, name = 'gainDb') => root.render(<CommitField label="Amplification" name={name} value={value}
		disabled={false} readOnly={false} multiline={false} onCommit={(name: string, value: string) => { committed.push({ name, value }); }} />);
	await act(async () => render('0'));
	const field = dom.one('input'), wrapper = dom.one('label');
	field.focus();
	await act(async () => reactProps(field).onFocus?.());
	const scan = deferred<string>();
	const scanned = scan.promise.then(value => render(value));
	const finishScan = async () => { await act(async () => { scan.resolve('26'); await scanned; }); };
	return { dom, field, wrapper, committed, render, finishScan };
}

test('a delayed Amplify default preserves the focused edited draft until its real blur commit', async context => {
	const f = await mountDeferredField(context);
	for (const value of ['', '6']) await act(async () => reactProps(f.field).onChange({ target: { value } }));
	await f.finishScan();
	assert.equal(f.field.value, '6');
	assert.deepEqual(f.committed, []);
	await act(async () => reactProps(f.field).onBlur());
	assert.deepEqual(f.committed, [{ name: 'gainDb', value: '6' }]);
	await act(async () => f.render('7'));
	assert.equal(f.field.value, '7', 'a later controlled update still reaches the blurred field');
});

for (const reverted of [false, true]) void test(`a focused ${reverted ? 'reverted' : 'untouched'} field follows its delayed controlled default`, async context => {
	const f = await mountDeferredField(context);
	if (reverted) for (const value of ['6', '0']) await act(async () => reactProps(f.field).onChange({ target: { value } }));
	await f.finishScan();
	assert.equal(f.field.value, '26');
	await act(async () => reactProps(f.field).onBlur());
	assert.deepEqual(f.committed, [{ name: 'gainDb', value: '26' }]);
});

test('changing field identity retires a focused draft and Escape restores the latest controlled value', async context => {
	const f = await mountDeferredField(context);
	await act(async () => reactProps(f.field).onChange({ target: { value: '6' } }));
	await f.finishScan();
	const target = { blur() { reactProps(f.field).onBlur(); } };
	await act(async () => reactProps(f.wrapper).onKeyDown({ key: 'Escape', target, preventDefault() {}, stopPropagation() {} }));
	assert.equal(f.field.value, '26');
	assert.deepEqual(f.committed, []);
	await act(async () => reactProps(f.field).onFocus?.());
	await act(async () => reactProps(f.field).onChange({ target: { value: '9' } }));
	await act(async () => f.render('4', 'otherGain'));
	assert.equal(f.field.value, '4', 'an old field draft cannot cross into a new named control');
	await act(async () => reactProps(f.field).onBlur());
	assert.deepEqual(f.committed, [{ name: 'otherGain', value: '4' }]);
});
