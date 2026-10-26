/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createDeferredDawprojectService } from '../src/common/editor/controller/import/deferred-dawproject-service.ts';
import * as module from '../src/common/editor/controller/import/internal/dawproject/dawproject-service.ts';
import { createFixture } from './helpers/native-project-service-fixture.ts';

for (const transition of ['switch', 'aba', 'same', 'edit', 'dispose'] as const) {
	for (const fails of [false, true]) test(`cold DAWproject export owns ${transition}; load failure=${fails}`, async () => {
		const fixture = createFixture();
		let release: () => void = () => undefined;
		let reject: (error: unknown) => void = () => undefined;
		const held = new Promise<void>((resolve, fail) => { release = resolve; reject = fail; });
		const subjects: string[] = [];
		const facade = createDeferredDawprojectService(fixture.runtime, {
			requireProject: () => { const project = fixture.runtime.getProject(); assert.ok(project); return project; },
		} as module.DawprojectServiceHelpers, async () => {
			await held;
			return { ...module, createDawprojectService: () => ({
				openDawproject: async () => undefined,
				saveDawproject: async () => {
					const project = fixture.runtime.getProject(); assert.ok(project); subjects.push(project.id);
					return { fileName: `${project.id}.dawproject`, report: null };
				},
			}) };
		});
		const pending = facade.saveDawproject();
		if (transition === 'switch' || transition === 'aba') fixture.replaceProject('incoming');
		if (transition === 'aba') fixture.replaceProject('project-a');
		if (transition === 'edit') Object.assign(fixture.runtime.getProject()!, { revision: 2 });
		if (transition === 'dispose') fixture.lifetime.beginDisposal();
		const failure = new Error('Module load failed');
		if (fails) reject(failure); else release();
		const retired = transition === 'switch' || transition === 'aba' || transition === 'dispose';
		if (retired) await assert.rejects(pending, (error: unknown) => error instanceof Error
			&& (error.name === 'AbortError' || error.name === 'EditorDisposedError'));
		else if (fails) await assert.rejects(pending, error => error === failure);
		else assert.equal((await pending).fileName, 'project-a.dawproject');
		assert.equal(subjects.length, !retired && !fails ? 1 : 0);
		if (retired && transition !== 'dispose' && !fails) {
			assert.equal((await facade.saveDawproject()).fileName, `${fixture.runtime.getProject()!.id}.dawproject`);
			assert.equal(subjects.length, 1, 'the incoming activation can make a fresh export');
		}
	});
}
