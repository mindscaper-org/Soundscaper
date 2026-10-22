/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import FramescaperFinishingDialog from '../src/common/editor/ui/dialogs/FramescaperFinishingDialog.tsx';
import { createFramescaperProject } from '../src/framescaper/editor-project.ts';
import { applyFramescaperProjectCommand } from '../src/framescaper/editor-project-commands.ts';
import { FRAMESCAPER_PROJECT_RUNTIME_PROFILE as PROFILE } from '../src/framescaper/editor-project-runtime-profile.ts';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

test('MI11: importing a named TTML track selects its preserved identity for immediate export', async () => {
	const dom = installReactTestDom();
	const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const previous = globals.IS_REACT_ACT_ENVIRONMENT;
	globals.IS_REACT_ACT_ENVIRONMENT = true;
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	let project = createFramescaperProject(PROFILE, { id: 'project' });
	const saved: string[] = [];
	const ttml = '<tt xmlns="http://www.w3.org/ns/ttml" xmlns:ttp="http://www.w3.org/ns/ttml#parameter" '
		+ 'xml:id="provider-english" xml:lang="en" xml:space="preserve" ttp:timeBase="media" '
		+ 'ttp:contentProfiles="http://www.w3.org/ns/ttml/profile/imsc1.1/text" ttp:tickRate="1000">'
		+ '<body><div><p xml:id="cue" begin="0t" end="1000t">Hello</p></div></body></tt>';
	const controller = { actions: { edit: { commit(command: unknown) {
		project = applyFramescaperProjectCommand(PROFILE, project, command);
	} } } };
	const render = () => root.render(<FramescaperFinishingDialog surface="captions" project={project} controller={controller}
		editingBlocked={false} readOnly={false} run={operation => operation()} onClose={() => undefined}
		fileService={{ isDesktop: true, chooseFiles: () => [new File([ttml], 'captions.ttml')],
			openReadDescriptor: value => value, saveFile: request => { saved.push(request.suggestedName); } }} />);
	try {
		await act(async () => { render(); });
		const choose = dom.container.querySelectorAll('button').find(node => node.textContent === 'Choose sidecar file');
		assert.ok(choose);
		await act(async () => { void reactProps(choose).onClick({}); await new Promise<void>(resolve => setImmediate(resolve)); });
		await act(async () => { render(); });
		assert.ok(Array.isArray(project.videoCaptionTracks) && project.videoCaptionTracks.some((track: unknown) =>
			track !== null && typeof track === 'object' && 'id' in track && track.id === 'provider-english'));
		const exportButton = dom.container.querySelectorAll('button').find(node => node.textContent === 'Export selected track');
		assert.ok(exportButton);
		await act(async () => { void reactProps(exportButton).onClick({}); await new Promise<void>(resolve => setImmediate(resolve)); });
		assert.deepEqual(saved, ['provider-english.ttml']);
	} finally {
		await act(async () => { root.unmount(); });
		dom.restore(); globals.IS_REACT_ACT_ENVIRONMENT = previous;
	}
});

test('MI12: caption import fields follow a newly selected project sequence', async () => {
	const dom = installReactTestDom();
	const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
	const previous = globals.IS_REACT_ACT_ENVIRONMENT;
	globals.IS_REACT_ACT_ENVIRONMENT = true;
	const { createRoot } = await import('react-dom/client');
	const root = createRoot(dom.container as unknown as Element);
	const createProject = (id: string) => createFramescaperProject(PROFILE, { id,
		primarySequenceId: `${id}-sequence`, sequences: [{ id: `${id}-sequence`, trackIds: [], rate: { num: 30, den: 1 } }] });
	let project = createProject('first');
	const controller = { actions: { edit: { commit(command: unknown) {
		project = applyFramescaperProjectCommand(PROFILE, project, command);
	} } } };
	const render = () => root.render(<FramescaperFinishingDialog surface="captions" project={project} controller={controller}
		editingBlocked={false} readOnly={false} run={operation => operation()} onClose={() => undefined}
		fileService={{ isDesktop: true, chooseFiles: () => [new File(['1\n00:00:00,000 --> 00:00:01,000\nNew captions\n'], 'captions.srt')],
			openReadDescriptor: value => value }} />);
	try {
		await act(async () => { render(); });
		project = createProject('second');
		await act(async () => { render(); });
		const choose = dom.container.querySelectorAll('button').find(node => node.textContent === 'Choose sidecar file');
		assert.ok(choose);
		await act(async () => { void reactProps(choose).onClick({}); await new Promise<void>(resolve => setImmediate(resolve)); });
		const tracks: unknown = project.videoCaptionTracks;
		assert.ok(Array.isArray(tracks));
		assert.equal(tracks.length, 1);
		const track: unknown = tracks[0];
		assert.ok(track !== null && typeof track === 'object' && 'sequenceId' in track);
		assert.equal(track.sequenceId, 'second-sequence');
	} finally {
		await act(async () => { root.unmount(); });
		dom.restore(); globals.IS_REACT_ACT_ENVIRONMENT = previous;
	}
});
