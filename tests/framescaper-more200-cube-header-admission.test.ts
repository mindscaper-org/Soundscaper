/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { createFramescaperProject } from '../src/framescaper/editor-project.ts';
import { applyFramescaperProjectCommand } from '../src/framescaper/editor-project-commands.ts';
import { createFramescaperFinishingCommand } from '../src/common/editor/ui/framescaper-finishing-dialog-model.ts';
import { createFramescaperCubeLutActionsFinishing } from '../src/framescaper/editor-cube-lut-actions-finishing.ts';
import { parseCubeLutV1 } from '../src/common/imaging/cube-lut-v1.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE as PROFILE } from '../src/framescaper/editor-project-runtime-profile.ts';
import { createMemoryProjectStore } from './helpers/memory-project-store.ts';

const TABLE = ['0 0 0', '1 0 0', '0 1 0', '1 1 0', '0 0 1', '1 0 1', '0 1 1', '1 1 1'];
for (const [name, lines] of [
	['repeated domain', ['DOMAIN_MIN 0 0 0', 'DOMAIN_MIN -1 -1 -1', 'LUT_3D_SIZE 2', ...TABLE]],
	['late domain', ['LUT_3D_SIZE 2', ...TABLE, 'DOMAIN_MIN -1 -1 -1']],
	['late size', [...TABLE, 'LUT_3D_SIZE 2']],
	['repeated title', ['TITLE "First"', 'TITLE "Second"', 'LUT_3D_SIZE 2', ...TABLE]],
] as const) test(`the real grading file runtime refuses a CUBE ${name} before publication`, async context => {
	let project = createFramescaperProject(PROFILE, { id: 'cube-header' });
	project = applyFramescaperProjectCommand(PROFILE, project,
		createFramescaperFinishingCommand('grading-presets', project, JSON.stringify({ videoVisualPresentations: [],
			videoFinishingPresets: [{ schemaVersion: 1, kind: 'video-finishing-preset', id: 'look', name: 'Look',
				template: { enabled: true, opacity: 1, blendMode: 'normal', grade: null } }],
		})));
	const initial = project, commands: unknown[] = [], store = createMemoryProjectStore(context, 'cube-header');
	const owner = { get project() { return project; }, actions: { edit: { commit(command: unknown) {
		commands.push(command); project = applyFramescaperProjectCommand(PROFILE, project, command);
	} } } };
	const runtime = createFramescaperCubeLutActionsFinishing({ owner, store });
	await assert.rejects(runtime.importCubeLut({ target: { kind: 'preset', id: 'look' },
		file: new File([lines.join('\n')], 'Ambiguous.cube', { type: 'text/plain' }) }), /keyword/iu);
	assert.equal(commands.length, 0); assert.equal(project, initial);
});

test('one of each CUBE keyword may appear in any order before the table and comments remain passive', () => {
	const parsed = parseCubeLutV1(['DOMAIN_MAX 1 1 1', 'TITLE "Header order"', '# comment', 'LUT_3D_SIZE 2',
		'DOMAIN_MIN 0 0 0', ...TABLE.slice(0, 3), '# data comment', ...TABLE.slice(3)].join('\n'));
	assert.equal(parsed.title, 'Header order'); assert.equal(parsed.size, 2); assert.equal(parsed.values.length, 24);
});
