/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { PhotoLibraryLinkedCommandsCurrentV1 as Commands } from '../src/common/editor/controller/composition/photo-library-linked-commands-current-v1.ts';
import { PhotoLinkedCommandsContextCurrentV1 as Context } from '../src/common/editor/ui/lightscaper/photo-linked-commands-context-current-v1.ts';
import { usePhotoLibraryWorkflowCurrentV1 as useWorkflow } from '../src/common/editor/ui/lightscaper/use-photo-library-workflow-current-v1.ts';
import { linkedWorkflowFixtureCurrentV1 as fixture, linked, options } from './helpers/lightscaper-native-linked-workflow-integration-fixture-current.ts';
import { mountPhotoImportUi } from './helpers/photo-import-options-react-fixture.tsx';

void test('Actual selected Current workflow slot keeps genuine linked Session identity through registered menu commands', options, async context => fixture(context, async f => {
	const { session, runtime } = await f.open(); let opens = 0, resolved = 0, entered = 0;
	const factory = async () => { opens++; return session; };
	const commands = new Commands({ resolveSession: async value => {
		resolved++; assert.equal(value, session);
		const selected = (await import('../src/lightscaper/desktop-photo-linked-library-current-v1.ts')).getDesktopPhotoLinkedLibraryCurrentV1(value);
		assert.equal(selected, runtime); return selected;
	}, revoke: async grantId => { await runtime.revoke(grantId); } });
	const view: { current?: ReturnType<typeof useWorkflow> } = {};
	function Harness() { view.current = useWorkflow(factory); return null; }
	let mounted: Awaited<ReturnType<typeof mountPhotoImportUi>> | undefined;
	try {
		mounted = await mountPhotoImportUi(() => <Context.Provider value={commands}><Harness /></Context.Provider>);
		assert.equal(opens, 0); assert.equal(resolved, 0);
		let rows = -1;
		await act(async () => { rows = await f.track(commands.run(async (selected, signal) => {
			entered++; assert.equal(selected, runtime); return (await selected.readGrants(null, { signal })).grants.length;
		})); });
		assert.ok(rows >= 0); assert.equal(opens, 1); assert.equal(resolved, 1); assert.equal(entered, 1);
		let reflected = 0;
		const forged = new Proxy({}, { get() { reflected++; throw new Error('Forged Session reflected.'); }, ownKeys() { reflected++; return []; } });
		assert.equal(linked(forged), null); assert.equal(reflected, 0);
	} finally {
		try { await act(async () => { await commands.cancelAndJoin(); await view.current?.retireAndJoin(); }); }
		finally { await mounted?.dispose(); }
	}
}));
for (const phase of ['acquire', 'resolve'] as const) void test(`Actual Current linked command preserves its exact ${phase} failure before entering the action`, options, async context => fixture(context, async f => {
	const { session, runtime } = await f.open(), reason = Symbol(`actual selected ${phase} failure`); let entered = 0;
	// The fixture retains this real Session even when the factory refuses to
	// publish it, so this admission failure cannot strand native ownership.
	const factory = async () => { await session.readPage(); if (phase === 'acquire') throw reason; return session; };
	const commands = new Commands({ resolveSession: async value => {
		assert.equal(value, session); assert.equal(linked(value), runtime); if (phase === 'resolve') throw reason; return runtime;
	}, revoke: async grantId => { await runtime.revoke(grantId); } });
	const view: { current?: ReturnType<typeof useWorkflow> } = {};
	function Harness() { view.current = useWorkflow(factory); return null; }
	let mounted: Awaited<ReturnType<typeof mountPhotoImportUi>> | undefined;
	try {
		mounted = await mountPhotoImportUi(() => <Context.Provider value={commands}><Harness /></Context.Provider>);
		await act(async () => { await assert.rejects(f.track(commands.run(async () => { entered++; })), error => Object.is(error, reason)); });
		assert.equal(entered, 0);
	} finally {
		try { await act(async () => { await commands.cancelAndJoin(); await view.current?.retireAndJoin(); }); }
		finally { await mounted?.dispose(); }
	}
}));
