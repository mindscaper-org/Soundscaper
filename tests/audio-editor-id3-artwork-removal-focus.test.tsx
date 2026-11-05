/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import Id3MetadataFields from '../src/common/editor/ui/Id3MetadataFields.tsx';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

const image = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6hxoAAAAASUVORK5CYII=';

for (const scenario of ['final', 'survivor', 'later-focus'] as const) test(`ID3 artwork removal retains ${scenario} focus ownership`, async () => {
	const dom = installReactTestDom();
	const root = createRoot(dom.container as unknown as HTMLElement);
	const priorReact = Object.getOwnPropertyDescriptor(globalThis, 'React');
	const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = globals.IS_REACT_ACT_ENVIRONMENT;
	globals.IS_REACT_ACT_ENVIRONMENT = true;
	Object.defineProperty(globalThis, 'React', { configurable: true, value: React });
	let metadata: Readonly<Record<string, unknown>> = { tags: { id3Artwork: JSON.stringify(
		Array.from({ length: scenario === 'survivor' ? 2 : 1 }, (_, index) => ({
			mimeType: 'image/png', pictureType: 3, description: `Cover ${index}`, data: image,
		})),
	) } };
	const update: { current: Readonly<Record<string, unknown>> | null } = { current: null };
	const render = async (): Promise<void> => { await act(async () => {
		root.render(<><Id3MetadataFields metadata={metadata} copy={ENGLISH_COPY} disabled={false}
			onUpdate={changes => { update.current = changes; }} /><button data-outside>Later choice</button></>);
	}); };
	try {
		await render();
		const controls = [...dom.container.querySelectorAll('button')].filter(button => button.textContent === 'Remove');
		const control = controls[0]!;
		control.focus();
		await act(async () => { reactProps(control).onClick?.({ currentTarget: control }); });
		assert.ok(update.current);
		// The browser drops a removed focused node to BODY; model that native step.
		if (scenario === 'later-focus') dom.one('[data-outside]').focus();
		else dom.container.ownerDocument.body.focus();
		metadata = { ...metadata, ...update.current };
		await render();
		const active = dom.container.ownerDocument.activeElement;
		if (scenario === 'later-focus') assert.equal(active?.hasAttribute('data-outside'), true);
		else if (scenario === 'final') {
			assert.equal(active?.tagName, 'INPUT');
			assert.equal(Reflect.get(active!, 'type'), 'file');
		}
		else {
			assert.ok(active);
			assert.equal(active.tagName, 'BUTTON');
			assert.equal(active.textContent, 'Remove');
		}
	} finally {
		await act(async () => { root.unmount(); });
		if (priorReact) Object.defineProperty(globalThis, 'React', priorReact);
		else Reflect.deleteProperty(globalThis, 'React');
		globals.IS_REACT_ACT_ENVIRONMENT = priorAct;
		dom.restore();
	}
});
