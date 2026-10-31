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
import { normalizeVideoFinishingPresetV1 } from '../src/common/editor/video-visual-presentation-v27.ts';
import { parseCubeLutV1, sampleCubeLut } from '../src/common/imaging/cube-lut-v1.ts';
import { createMemoryProjectStore } from './helpers/memory-project-store.ts';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

for (const title of ['Signed zero identity', '']) test(`the grading file picker imports a CUBE with ${title ? 'signed-zero numbers' : 'an empty optional title'} and preserves its exact digest`, async context => {
	const body = [`TITLE "${title}"`, 'LUT_3D_SIZE 2', 'DOMAIN_MIN -0 -0.000000 -0e0',
		'-0.000000 -0 0', '1 0 0', '0 1 0', '1 1 0', '0 0 1', '1 0 1', '0 1 1', '1 1 1', ''].join('\n');
	const file = new File([body], 'Identity.cube', { type: 'text/plain' });
	const dom = installReactTestDom();
	const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const previous = globals.IS_REACT_ACT_ENVIRONMENT; globals.IS_REACT_ACT_ENVIRONMENT = true;
	const root = createRoot(dom.container as unknown as Element);
	let project = createFramescaperProject(PROFILE, { id: 'signed-zero-cube' });
	project = applyFramescaperProjectCommand(PROFILE, project,
		createFramescaperFinishingCommand('grading-presets', project, JSON.stringify({ videoVisualPresentations: [],
			videoFinishingPresets: [{ schemaVersion: 1, kind: 'video-finishing-preset', id: 'look', name: 'Look',
				template: { enabled: true, opacity: 1, blendMode: 'normal', grade: null } }],
		})));
	const commands: unknown[] = [];
	const controller = { get project() { return project; }, actions: { edit: { commit(command: unknown) {
		commands.push(command); project = applyFramescaperProjectCommand(PROFILE, project, command);
	} } } };
	const store = createMemoryProjectStore(context, 'signed-zero-cube');
	bindFramescaperCubeLutActionsFinishing(controller,
		createFramescaperCubeLutActionsFinishing({ owner: controller, store }));
	try {
		await act(async () => root.render(<FramescaperFinishingDialog surface="grading-presets" controller={controller}
			project={project} editingBlocked={false} readOnly={false} run={operation => operation()} onClose={() => undefined}
			fileService={{ isDesktop: true, chooseFiles: () => [file], openReadDescriptor: descriptor => descriptor }} />));
		const choose = dom.container.querySelectorAll('button').find(button => button.textContent?.includes('Choose .cube'));
		assert.ok(choose);
		await act(async () => { reactProps(choose).onClick({}); await new Promise<void>(resolve => setImmediate(resolve)); });
		assert.equal(commands.length, 1, 'the standards-compliant metadata and numeric tokens must reach the native finishing command');
		const presets: unknown = project.videoFinishingPresets; assert.ok(Array.isArray(presets));
		const preset = normalizeVideoFinishingPresetV1(presets[0]);
		const reference = preset.template.grade?.lut; assert.ok(reference);
		const stored: unknown = await store.loadMediaAsset(reference.storageKey); assert.ok(stored instanceof Blob);
		assert.equal(await stored.text(), body, 'immutable storage retains original signed-zero file bytes');
		const parsed = parseCubeLutV1(await stored.text());
		assert.equal(parsed.title, title);
		assert.equal(parsed.sha256, reference.sha256);
		assert.deepEqual(reference.domainMin, [0, 0, 0]);
		assert.equal(parsed.values.some(value => Object.is(value, -0)), false);
		assert.deepEqual(sampleCubeLut(parsed, [0.25, 0.5, 0.75]), [0.25, 0.5, 0.75]);
	} finally {
		await act(async () => root.unmount());
		dom.restore(); globals.IS_REACT_ACT_ENVIRONMENT = previous;
	}
});
