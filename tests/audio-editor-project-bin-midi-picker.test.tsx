/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import ProjectBinPanel from '../src/common/editor/ui/workspace/ProjectBinPanel.jsx';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { installReactTestDom } from './helpers/react-test-dom.ts';

test('Project Bin import admits MIDI files while audio replacement keeps its media filter', async () => {
	const dom = installReactTestDom();
	const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const previousAct = globals.IS_REACT_ACT_ENVIRONMENT;
	const previousReact = Object.getOwnPropertyDescriptor(globalThis, 'React');
	globals.IS_REACT_ACT_ENVIRONMENT = true;
	Object.defineProperty(globalThis, 'React', { configurable: true, value: React });
	const root = createRoot(dom.container as unknown as Element);
	const project = { id: 'project', revision: 0, tracks: [], sources: [], projectBin: { clips: [] } };
	const controller = { getSnapshot: () => ({ project }), actions: { projectBin: {}, project: {} } };
	try {
		await act(async () => root.render(<ProjectBinPanel controller={controller} snapshot={{ project, missingSourceIds: [] }}
			copy={ENGLISH_COPY} locale="en" fileService={{ linkedAudioOriginalsAvailable: false, linkedVideoOriginalsAvailable: false }} run={(operation: () => unknown) => operation()} blocked={false} />));
		const imports = dom.one('[data-project-bin-input]').getAttribute('accept')?.split(',');
		const replacements = dom.one('[data-project-bin-replacement-input]').getAttribute('accept')?.split(',');
		for (const extension of ['.mid', '.midi', '.gro']) {
			assert.ok(imports?.includes(extension), extension);
			assert.ok(!replacements?.includes(extension), `audio replacement ${extension}`);
		}
	} finally {
		await act(async () => root.unmount());
		if (previousReact) Object.defineProperty(globalThis, 'React', previousReact);
		else Reflect.deleteProperty(globalThis, 'React');
		globals.IS_REACT_ACT_ENVIRONMENT = previousAct; dom.restore();
	}
});
