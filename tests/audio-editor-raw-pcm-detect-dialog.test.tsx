/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { RawPcmImportDialog } from '../src/common/editor/ui/dialogs/ImportAnalysisDialogs.tsx';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

test('Detect fills encoding, byte order and channels without submitting or replacing rate and offset', async () => {
	await withDialog(async h => {
		assert.equal(h.button('Detect').hasAttribute('disabled'), true);
		await h.choose(stereoFile());
		await h.number(0, '48000'); await h.number(2, '4');
		await h.click('Detect');
		assert.deepEqual(h.settings(), ['int24', 'big', '48000', '2', '4']);
		assert.equal(h.imports.length, 0);
		assert.equal(h.closes(), 0);
		await h.submit();
		const imported = h.imports[0]; assert.ok(imported);
		const header = new DataView(await imported.arrayBuffer());
		assert.equal(header.getUint16(22, true), 2);
		assert.equal(header.getUint16(34, true), 24);
		assert.equal(header.getUint32(24, true), 48000);
		assert.equal(h.closes(), 1);
	});
});

test('inconclusive detection keeps manual settings and reports the result', async () => {
	await withDialog(async h => {
		await h.choose(new File([new Uint8Array(4096)], 'silence.raw'));
		const before = h.settings();
		await h.click('Detect');
		assert.deepEqual(h.settings(), before);
		assert.match(h.dom.one('[role="status"]').textContent, /could not detect/iu);
		assert.equal(h.button('Detect').hasAttribute('disabled'), false);
	});
});

for (const retire of ['cancel', 'file', 'project', 'unmount'] as const) {
	test(`pending detection is single-flight and cannot publish after ${retire}`, async () => {
		await withDialog(async h => {
			const source = stereoFile();
			const body = await source.slice(4).arrayBuffer();
			let release!: (data: ArrayBuffer) => void;
			const read = new Promise<ArrayBuffer>(resolve => { release = resolve; });
			let reads = 0;
			const delayed = { size: body.byteLength, slice() { reads += 1; return { arrayBuffer: () => read }; } } as unknown as File;
			await h.choose(delayed);
			try {
				await act(async () => {
					reactProps(h.button('Detect')).onClick();
					reactProps(h.button('Detect')).onClick();
					reactProps(h.dom.one('form')).onSubmit({ preventDefault() {} });
				});
				assert.equal(reads, 1);
				assert.equal(h.dom.one('form').getAttribute('aria-busy'), 'true');
				assert.equal(h.button('Import').hasAttribute('disabled'), true);
				if (retire === 'cancel') await act(async () => { reactProps(h.button('Cancel')).onClick(); });
				if (retire === 'file') await h.choose(new File([new Uint8Array(256)], 'replacement.raw'));
				if (retire === 'project') await h.replaceProject();
				if (retire === 'unmount') await h.unmount();
			} finally {
				await act(async () => { release(body); await Promise.all(h.running); });
			}
			assert.equal(reads, 1, 'a retired read must not continue sampling');
			assert.equal(h.imports.length, 0);
			assert.equal(h.closes(), retire === 'cancel' ? 1 : 0);
			if (retire !== 'unmount') assert.deepEqual(h.settings(), ['int16', 'little', '44100', '1', '0']);
		});
	});
}

test('read failures are reported by the runner and release the Detect button', async () => {
	await withDialog(async h => {
		await h.choose({ size: 4096, slice() { throw new Error('Read failed'); } } as unknown as File);
		await act(async () => { reactProps(h.button('Detect')).onClick(); await Promise.allSettled(h.running); });
		assert.equal((await Promise.allSettled(h.running))[0]?.status, 'rejected');
		assert.equal(h.button('Detect').hasAttribute('disabled'), false);
		assert.deepEqual(h.settings(), ['int16', 'little', '44100', '1', '0']);
	});
});

test('Detect respects an edit block even when its handler is invoked directly', async () => {
	await withDialog(async h => {
		await h.choose(stereoFile());
		await h.blockEdits();
		assert.equal(h.button('Detect').hasAttribute('disabled'), true);
		await h.click('Detect');
		assert.equal(h.running.length, 0);
		assert.deepEqual(h.settings(), ['int16', 'little', '44100', '1', '0']);
	});
});

async function withDialog(operation: (h: Awaited<ReturnType<typeof mountDialog>>) => Promise<void>) {
	const h = await mountDialog();
	try { await operation(h); } finally { await h.cleanup(); }
}

async function mountDialog() {
	const dom = installReactTestDom();
	const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const prior = globals.IS_REACT_ACT_ENVIRONMENT; globals.IS_REACT_ACT_ENVIRONMENT = true;
	const root = createRoot(dom.container as unknown as Element);
	const running: Promise<unknown>[] = [], imports: File[] = [];
	let closes = 0, generation = 0, mounted = true, blocked = false;
	const controller = { project: null, captureProjectGeneration: () => ({ projectId: null, generation }), actions: {
		project: { importFiles: (files: readonly File[]) => { imports.push(...files); } },
		timelineAnnotations: { regularInterval: () => undefined },
	} };
	const render = async () => {
		await act(async () => { root.render(<RawPcmImportDialog controller={controller} copy={ENGLISH_COPY} snapshot={{ readOnly: blocked }}
			run={operation => { const pending = Promise.resolve(operation()); running.push(pending); return pending; }}
			onClose={() => { closes += 1; }} />); });
	};
	await render();
	const button = (label: string) => {
		const result = dom.container.querySelectorAll('button').find(button => button.textContent === label);
		assert.ok(result, `Missing button ${label}`); return result;
	};
	const numbers = () => dom.container.querySelectorAll('input').filter(input => input.type === 'number');
	const unmount = async () => { if (mounted) { await act(async () => { root.unmount(); }); mounted = false; } };
	return { dom, running, imports, button, unmount, closes: () => closes,
		settings: () => [...dom.container.querySelectorAll('select').map(select => Reflect.get(reactProps(select), 'value')), ...numbers().map(input => input.value)],
		async choose(file: File) { await act(async () => { reactProps(dom.one('input')).onChange({ currentTarget: { files: [file] } }); }); },
		async number(index: number, value: string) { await act(async () => { reactProps(numbers()[index]!).onChange({ currentTarget: { value } }); }); },
		async click(label: string) { await act(async () => { reactProps(button(label)).onClick(); await Promise.all(running); }); },
		async submit() { await act(async () => { reactProps(dom.one('form')).onSubmit({ preventDefault() {} }); await Promise.all(running); }); },
		async replaceProject() { generation += 1; await render(); },
		async blockEdits() { blocked = true; await render(); },
		async cleanup() { await unmount(); dom.restore(); globals.IS_REACT_ACT_ENVIRONMENT = prior; },
	};
}

function stereoFile(): File {
	const body = new Uint8Array(4 + 4096 * 6);
	for (let frame = 0; frame < 4096; frame += 1) {
		for (let channel = 0; channel < 2; channel += 1) {
			const value = Math.round(Math.sin(frame * (channel ? .091 : .057) + channel) * 4_000_000);
			const start = 4 + frame * 6 + channel * 3;
			body[start] = (value >> 16) & 255; body[start + 1] = (value >> 8) & 255; body[start + 2] = value & 255;
		}
	}
	return new File([body], 'stereo.raw');
}
