/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import ProjectMetadataPanel from '../src/common/editor/ui/workspace/ProjectMetadataPanel.tsx';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

test('MP21: project metadata drafts cannot leak into another project with equal saved field values', async () => {
	const dom = installReactTestDom();
	const root = createRoot(dom.container as unknown as Element);
	const priorReact = Object.getOwnPropertyDescriptor(globalThis, 'React');
	Object.defineProperty(globalThis, 'React', { configurable: true, value: React });
	const environment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = environment.IS_REACT_ACT_ENVIRONMENT;
	environment.IS_REACT_ACT_ENVIRONMENT = true;
	const updates: unknown[] = [];
	const render = async (projectId: string) => {
		await act(async () => root.render(<ProjectMetadataPanel project={{ id: projectId, metadata: { artist: '' } }}
			copy={ENGLISH_COPY} disabled={false} onUpdate={(changes) => updates.push({ projectId, changes })} />));
	};
	try {
		await render('original');
		const artist = dom.container.querySelectorAll('input').find((field) => field.name === 'artist');
		assert.ok(artist);
		await act(async () => { reactProps(artist).onChange({ currentTarget: { value: 'Old project draft' } }); });
		await render('replacement');
		const nextArtist = dom.container.querySelectorAll('input').find((field) => field.name === 'artist');
		assert.ok(nextArtist);
		assert.equal(reactProps(nextArtist).value, '');
		await act(async () => { reactProps(nextArtist).onBlur(); });
		assert.deepEqual(updates, []);
	} finally {
		await act(async () => root.unmount());
		environment.IS_REACT_ACT_ENVIRONMENT = priorAct;
		if (priorReact) Object.defineProperty(globalThis, 'React', priorReact);
		else Reflect.deleteProperty(globalThis, 'React');
		dom.restore();
	}
});
