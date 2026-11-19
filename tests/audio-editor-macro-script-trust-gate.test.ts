/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createEffectMacroActions,
	type EffectLibraryActionScope,
} from '../src/common/editor/controller/effects/effect-library-action-groups.ts';
import { createEffectMacroLibrary } from '../src/common/editor/effect-macro-library.js';
import { createMacroScriptLibrary } from '../src/common/editor/macro-script-library.ts';
import { serializeMacroScriptEnvelope } from '../src/common/editor/macro-script-envelope.ts';
import {
	EDITOR_PROJECT_TASK_SCOPE, EditorControllerLifetime, type EditorTaskScope,
} from '../src/common/editor/controller/shared/lifecycle.ts';

interface MacroScriptRecord {
	readonly id: string;
	readonly name: string;
	readonly trust: string;
	readonly origin: unknown;
	readonly trustedSource: unknown;
}

/**
 * What this test drives. The action group describes its members as the
 * capability wrapper leaves them — arguments withheld — so the fixture states
 * the calls it makes rather than casting at each one.
 */
interface MacroScriptActions {
	readonly scripts: Readonly<{
		import: (envelope: string, fileName?: string) => MacroScriptRecord;
		trust: (id: string) => unknown;
		blocked: (source: string) => boolean;
		list: () => readonly MacroScriptRecord[];
		export: (id: string) => string;
	}>;
	readonly runScript: (script: Readonly<{ name: string; source: string }>) => Promise<unknown>;
}

function createMacroActions(options: Readonly<{
	startMacroScriptTask?: () => EditorTaskScope;
	beginMacroTransaction?: () => Readonly<{
		assertCurrent(): void;
		commit(): void;
		rollback(): void;
	}>;
}> = {}): MacroScriptActions {
	let minted = 0;
	const lifetime = new EditorControllerLifetime();
	const state = {
		effectMacros: createEffectMacroLibrary(),
		macroScripts: createMacroScriptLibrary(),
	};
	return createEffectMacroActions({
		state: { projectAdministrationPending: false },
		effectLibraryState: state,
		createStableId: (prefix: string) => `${prefix}-${++minted}`,
		persistSetting: async () => {},
		publishDocumentSnapshot: () => {},
		handleError: (error: unknown) => { throw error; },
		copy: { untitledMacro: 'Untitled macro' },
		getProject: () => ({ tracks: [], selection: null }),
		projectSampleRate: () => 48_000,
		timelineDurationFrames: () => 0,
		selection: Object.freeze({ setExactSelection: () => undefined }),
		beginMacroTransaction: options.beginMacroTransaction ?? (() => ({
			assertCurrent: () => undefined, commit: () => undefined, rollback: () => undefined,
		})),
		startMacroScriptTask: options.startMacroScriptTask ?? (() => lifetime.startTask(
			'macro-script', { scope: EDITOR_PROJECT_TASK_SCOPE },
		)),
		cancelEffectMacro: () => false,
	} as unknown as EffectLibraryActionScope,
	(_capability, action) => action,
	) as unknown as MacroScriptActions;
}

test('an imported program reaches the sandbox task only after an explicit run', async () => {
	let starts = 0;
	const macros = createMacroActions({ startMacroScriptTask: () => { starts++; throw new Error('Sandbox task entered'); } });
	const imported = macros.scripts.import(
		serializeMacroScriptEnvelope({ name: 'Sweep', source: 'await sound.select.all();' }),
		'sweep.soundscapemacro',
	);
	assert.equal(imported.origin, 'sweep.soundscapemacro');
	assert.equal(starts, 0, 'importing must not execute the program');
	assert.equal(macros.scripts.blocked('await sound.select.all();'), false);
	await assert.rejects(macros.runScript({ name: 'Sweep', source: 'await sound.select.all();' }), /Sandbox task entered/u);
	assert.equal(starts, 1);
});

test('a project lifecycle cancellation stops a script during sandbox loading', async () => {
	const lifetime = new EditorControllerLifetime();
	let rolledBack = false;
	const macros = createMacroActions({
		startMacroScriptTask: () => lifetime.startTask('macro-script', { scope: EDITOR_PROJECT_TASK_SCOPE }),
		beginMacroTransaction: () => ({
			assertCurrent: () => undefined,
			commit: () => { throw new Error('A cancelled script must not commit.'); },
			rollback: () => { rolledBack = true; },
		}),
	});
	const run = macros.runScript({ name: 'Old project', source: 'await sound.select.none();' });
	lifetime.cancelScope(EDITOR_PROJECT_TASK_SCOPE);
	await assert.rejects(run, (error: Error) => error.name === 'AbortError');
	assert.equal(rolledBack, true);
});

test('importing stores source and provenance without running the program', () => {
	const macros = createMacroActions();
	assert.throws(() => macros.scripts.import('await sound.select.all();'), /not a macro program file/u);
	const imported = macros.scripts.import(
		serializeMacroScriptEnvelope({ name: 'Sweep', source: 'await sound.log("hi");' }),
	);
	assert.equal(imported.origin, null);
	assert.equal(imported.trustedSource, null);
	assert.deepEqual(macros.scripts.list().map(({ name, trust }) => ({ name, trust })), [
		{ name: 'Sweep', trust: 'imported-untrusted' },
	]);
	assert.equal(JSON.parse(macros.scripts.export(imported.id)).source, 'await sound.log("hi");');
});
