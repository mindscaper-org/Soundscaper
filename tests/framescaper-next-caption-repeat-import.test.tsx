/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import FramescaperFinishingDialog from '../src/common/editor/ui/dialogs/FramescaperFinishingDialog.tsx';
import { createFramescaperProject } from '../src/framescaper/editor-project.ts';
import { applyFramescaperProjectCommand } from '../src/framescaper/editor-project-commands.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE as PROFILE } from '../src/framescaper/editor-project-runtime-profile.ts';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

test('reimporting the same sidecar succeeds without issuing a native no-op history command', async () => {
	const dom = installReactTestDom();
	const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const previous = globals.IS_REACT_ACT_ENVIRONMENT; globals.IS_REACT_ACT_ENVIRONMENT = true;
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	let project = createFramescaperProject(PROFILE, { id: 'repeat-captions' });
	let commits = 0;
	let content = sidecar('Speech');
	const controller = { actions: { edit: { commit(command: unknown) {
		project = applyFramescaperProjectCommand(PROFILE, project, command); commits += 1;
	} } } };
	const render = () => root.render(<FramescaperFinishingDialog surface="captions" project={project} controller={controller}
		editingBlocked={false} readOnly={false} run={operation => operation()} onClose={() => undefined}
		fileService={{ isDesktop: true, chooseFiles: () => [new File([content], 'captions.ttml')], openReadDescriptor: value => value }} />);
	const choose = async (): Promise<void> => {
		const button = dom.container.querySelectorAll('button').find(node => node.textContent === 'Choose sidecar file');
		assert.ok(button);
		await act(async () => { void reactProps(button).onClick({}); await new Promise<void>(resolve => setImmediate(resolve)); });
		await act(async () => { render(); });
	};
	try {
		await act(async () => { render(); });
		await choose(); assert.equal(commits, 1);
		const first = project;
		await choose();
		assert.doesNotMatch(dom.container.textContent, /must mutate state|no-op commands/u);
		assert.equal(commits, 1); assert.equal(project, first);
		const paste = dom.container.querySelectorAll('button').find(node => node.textContent === 'Import sidecar text');
		assert.ok(paste);
		await act(async () => { void reactProps(paste).onClick({}); });
		assert.doesNotMatch(dom.container.textContent, /must mutate state|no-op commands/u);
		assert.equal(commits, 1); assert.equal(project, first);
		content = sidecar('Updated speech'); await choose();
		assert.equal(commits, 2); assert.notEqual(project, first);
		assert.match(dom.container.textContent, /captions\.ttml:/u);
	} finally {
		await act(async () => root.unmount()); dom.restore(); globals.IS_REACT_ACT_ENVIRONMENT = previous;
	}
});

function sidecar(text: string): string {
	return '<tt xmlns="http://www.w3.org/ns/ttml" xmlns:ttp="http://www.w3.org/ns/ttml#parameter" '
		+ 'xml:id="captions" xml:lang="en" xml:space="preserve" ttp:timeBase="media" '
		+ 'ttp:contentProfiles="http://www.w3.org/ns/ttml/profile/imsc1.1/text" ttp:tickRate="1000">'
		+ `<body><div><p xml:id="cue" begin="0t" end="1000t">${text}</p></div></body></tt>`;
}
