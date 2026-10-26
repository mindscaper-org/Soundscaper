/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import FramescaperFinishingDialog from '../src/common/editor/ui/dialogs/FramescaperFinishingDialog.tsx';
import { createFramescaperFinishingCommand } from '../src/common/editor/ui/framescaper-finishing-dialog-model.ts';
import { createFramescaperProject } from '../src/framescaper/editor-project.ts';
import { applyFramescaperProjectCommand } from '../src/framescaper/editor-project-commands.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE as PROFILE } from '../src/framescaper/editor-project-runtime-profile.ts';
import { createFramescaperCubeLutActionsFinishing, bindFramescaperCubeLutActionsFinishing } from '../src/framescaper/editor-cube-lut-actions-finishing.ts';
import { parseCubeLutV1, sampleCubeLut } from '../src/common/editor/video-color-cube-lut-v27.ts';
import { createMemoryProjectStore } from './helpers/memory-project-store.ts';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

for (const [placement, token] of [['table', '0x1'], ['table', '0b1'], ['table', '0o1'], ['domain', '0x1'], ['table', '1e38']] as const) {
	test(`the grading chooser refuses ${token} in a CUBE ${placement} before native publication`, async context => {
		const body = ['LUT_3D_SIZE 2', ...(placement === 'domain' ? [`DOMAIN_MAX ${token} 1 1`] : []),
			...Array.from({ length: 8 }, () => placement === 'table' ? `${token} 0 0` : '0 0 0'), ''].join('\n');
		const file = new File([body], 'Malformed.cube', { type: 'text/plain' });
		const dom = installReactTestDom(), globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
		const previous = globals.IS_REACT_ACT_ENVIRONMENT; globals.IS_REACT_ACT_ENVIRONMENT = true;
		const root = createRoot(dom.container as unknown as Element);
		let project = createFramescaperProject(PROFILE, { id: 'cube-numeric' });
		project = applyFramescaperProjectCommand(PROFILE, project,
			createFramescaperFinishingCommand('grading-presets', project, JSON.stringify({ videoVisualPresentations: [],
				videoFinishingPresets: [{ schemaVersion: 1, kind: 'video-finishing-preset', id: 'look', name: 'Look',
					template: { enabled: true, opacity: 1, blendMode: 'normal', grade: null } }],
			})));
		const initial = project, commands: unknown[] = [];
		const controller = { get project() { return project; }, actions: { edit: { commit(command: unknown) {
			commands.push(command); project = applyFramescaperProjectCommand(PROFILE, project, command);
		} } } };
		const store = createMemoryProjectStore(context, 'cube-numeric');
		bindFramescaperCubeLutActionsFinishing(controller, createFramescaperCubeLutActionsFinishing({ owner: controller, store }));
		try {
			await act(async () => root.render(<FramescaperFinishingDialog surface="grading-presets" controller={controller}
				project={project} editingBlocked={false} readOnly={false} run={operation => operation()} onClose={() => undefined}
				fileService={{ isDesktop: true, chooseFiles: () => [file], openReadDescriptor: descriptor => descriptor }} />));
			const choose = dom.container.querySelectorAll('button').find(button => button.textContent?.includes('Choose .cube')); assert.ok(choose);
			await act(async () => { reactProps(choose).onClick({}); await new Promise<void>(resolve => setImmediate(resolve)); });
			assert.equal(commands.length, 0, 'a malformed number must not reach the native grading command');
			assert.equal(project, initial);
		} finally { await act(async () => root.unmount()); dom.restore(); globals.IS_REACT_ACT_ENVIRONMENT = previous; }
	});
}

test('decimal CUBE scalars retain signs, fractional forms, exponents and exact original bytes', () => {
	const body = ['LUT_3D_SIZE 2', 'DOMAIN_MIN -0 -.0 -0e0', 'DOMAIN_MAX +1.0 1e0 1.',
		...Array.from({ length: 8 }, () => '+.25 5E-1 0.750'), ''].join('\n');
	const parsed = parseCubeLutV1(body);
	assert.equal(parsed.byteLength, new TextEncoder().encode(body).byteLength);
	assert.deepEqual(sampleCubeLut(parsed, [0.25, 0.5, 0.75]), [0.25, 0.5, 0.75]);
});
