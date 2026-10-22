/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import FramescaperFinishingDialog from '../src/common/editor/ui/dialogs/FramescaperFinishingDialog.tsx';
import { createFramescaperProject } from '../src/framescaper/editor-project.ts';
import { applyFramescaperProjectCommand } from '../src/framescaper/editor-project-commands.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE as PROFILE } from '../src/framescaper/editor-project-runtime-profile.ts';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

const SRT = '1\n00:00:00,000 --> 00:00:01,000\nIncoming caption\n';

test('a pending outgoing caption file read cannot block or report into the next project', async () => {
	const dom = installReactTestDom();
	const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const priorAct = globals.IS_REACT_ACT_ENVIRONMENT;
	globals.IS_REACT_ACT_ENVIRONMENT = true;
	const root = createRoot(dom.container as unknown as Element);
	let rejectOld: (error: Error) => void = () => undefined;
	const oldBody = new Promise<ArrayBuffer>((_resolve, reject) => { rejectOld = reject; });
	const outgoing = new File([SRT], 'outgoing.srt');
	Object.defineProperty(outgoing, 'arrayBuffer', { value: () => oldBody });
	let chosenFile = outgoing;
	let project = createFramescaperProject(PROFILE, { id: 'outgoing' });
	const commits: string[] = [];
	const controller = { actions: { edit: { commit(command: unknown) {
		commits.push(String(project.id));
		project = applyFramescaperProjectCommand(PROFILE, project, command);
	} } } };
	const render = () => root.render(<FramescaperFinishingDialog surface="captions" project={project} controller={controller}
		editingBlocked={false} readOnly={false} run={operation => operation()} onClose={() => undefined}
		fileService={{ isDesktop: true, chooseFiles: () => [chosenFile], openReadDescriptor: value => value }} />);
	const choose = () => {
		const button = dom.container.querySelectorAll('button').find(node => node.textContent === 'Choose sidecar file');
		assert.ok(button); return button;
	};
	try {
		await act(async () => { render(); });
		await act(async () => { void reactProps(choose()).onClick({}); await new Promise<void>(resolve => setImmediate(resolve)); });
		assert.equal(reactProps(choose()).disabled, true);
		project = createFramescaperProject(PROFILE, { id: 'incoming' });
		await act(async () => { render(); });
		assert.equal(reactProps(choose()).disabled, false, 'a new project owns an immediately usable caption editor');
		chosenFile = new File([SRT], 'incoming.srt');
		await act(async () => { void reactProps(choose()).onClick({}); await new Promise<void>(resolve => setImmediate(resolve)); });
		assert.deepEqual(commits, ['incoming']);
		await act(async () => { rejectOld(new Error('outgoing file read failed')); await new Promise<void>(resolve => setImmediate(resolve)); });
		assert.equal(dom.container.textContent.includes('outgoing file read failed'), false);
		assert.equal(reactProps(choose()).disabled, false);
	} finally {
		rejectOld(new Error('retired'));
		await act(async () => { root.unmount(); }); dom.restore(); globals.IS_REACT_ACT_ENVIRONMENT = priorAct;
	}
});
