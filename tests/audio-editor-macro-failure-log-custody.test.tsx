/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import MacroScriptPanel from '../src/common/editor/ui/inspector/MacroScriptPanel.jsx';
import { resolveMacroManagerCopy } from '../src/common/editor/ui/inspector/macro-manager-copy.ts';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { validateSoundscaperProject } from '../src/soundscaper/editor-project-validation.ts';
import { controllerSession } from './helpers/soundscaper-controller-session.ts';
import { registerMockModuleUrls } from './helpers/mock-module-urls.ts';
import { mountControllerDataDom } from './helpers/controller-data-dom.ts';
import { reactProps } from './helpers/react-test-dom.ts';

test('a real mounted program retains its preceding log when the shipping sandbox/controller fails', async context => {
	const hooks = registerMockModuleUrls({ '../../macro-script/browser-sandbox.ts': new URL('./helpers/macro-vm-worker-transport.ts', import.meta.url).href });
	context.after(() => { hooks.deregister(); });
	const { controller, store } = await controllerSession(context, {
		engineFactory: () => { throw new Error('A diagnostic-only program must not render audio.'); },
	});
	const scripts = controller.actions.macros.scripts;
	const script = scripts.save({ name: 'New program', source: "sound.log.info('before error'); throw new Error('example error');" });
	await scripts.flush();
	await controller.actions.project.flush();
	const before = structuredClone(controller.project), history = structuredClone(controller.getSnapshot().history);
	assert.ok(validateSoundscaperProject(before));
	const savedScripts = structuredClone(scripts.list());
	const fixture = mountControllerDataDom();
	try {
		const copy = resolveMacroManagerCopy('en', ENGLISH_COPY);
		await fixture.render(<MacroScriptPanel controller={controller} copy={copy} script={script} blocked={false}
			fileService={{}} onChange={(next: unknown) => { scripts.save(next); }} />);
		const run = fixture.dom.container.querySelectorAll('button').find(button => button.textContent === copy.runProgram); assert.ok(run);
		await act(async () => { await reactProps(run).onClick(); });
		const log = fixture.dom.one('[data-macro-script-log]');
		assert.equal(log.getAttribute('data-outcome'), 'failed');
		assert.equal(fixture.dom.one('[data-macro-script-log-level="info"]').textContent, 'before error');
		assert.equal(log.querySelectorAll('p').length, 1, 'failure must retain exactly the program-authored diagnostic');
		assert.match(fixture.dom.one('[data-macro-script-failure]').textContent, /example error/u);
		assert.equal(fixture.dom.container.querySelectorAll('[role="alert"]').length, 1);
		const retry = fixture.dom.container.querySelectorAll('button').find(button => button.textContent === copy.runProgram); assert.ok(retry);
		assert.equal(retry.getAttribute('disabled'), null);
		assert.deepEqual(controller.project, before); assert.deepEqual(controller.getSnapshot().history, history);
		assert.deepEqual(scripts.list(), savedScripts);
		assert.deepEqual(await store.loadProject(before.id), before);
	} finally { await fixture.dispose(); }
});
