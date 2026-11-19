/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import type { TestContext } from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { createAudacityLabelActionRuntime } from '../../src/common/editor/audacity-label-action-runtime.ts';
import { importWorkspaceRoutedFiles } from '../../src/common/editor/ui/workspace/import-workspace-routed-files.ts';
import WorkspacePanelContent from '../../src/common/editor/ui/workspace/WorkspacePanelContent.jsx';
import { validateSoundscaperProject } from '../../src/soundscaper/editor-project-validation.ts';
import type { SoundscaperProject } from '../../src/soundscaper/editor-project.ts';
import { ENGLISH_COPY } from '../../src/common/i18n/catalogs.js';
import { assertEditedAudioArchiveCustody } from './edited-audio-archive-custody.ts';
import { createMemoryFfmpeg } from './audio-editor-controller-fixtures.js';
import { COPY } from './audio-editor-controller-harness.js';
import { installReactTestDom, reactProps } from './react-test-dom.ts';
import { controllerSession } from './soundscaper-controller-session.ts';

type Session = Awaited<ReturnType<typeof controllerSession>>;
type Controller = Session['controller'];

export async function labelCustodySession(context: TestContext): Promise<Session> {
	type Options = NonNullable<Parameters<typeof controllerSession>[1]>;
	const ffmpeg = { ...createMemoryFfmpeg(), async decode() { throw new Error('A label file must not be replaced by decoded audio.'); },
		async encode() { throw new Error('Label custody has no encoded audio output.'); } };
	return controllerSession(context, { ffmpeg: ffmpeg as unknown as Options['ffmpeg'],
		engineFactory: () => { throw new Error('Label custody must stop before native rendering.'); } });
}

export async function importWorkspaceLabels(controller: Controller, file: File): Promise<void> {
	assert.equal(await importWorkspaceRoutedFiles({ controller, files: [file], importOptions: {}, projectBinVisible: false,
		openProjectFile() { assert.fail('A label sidecar must not open a project.'); },
		requestCueImport: selected => controller.actions.labels.importCueFile(selected, 'labels'),
	}), 1);
}

export function labelProject(value: unknown): SoundscaperProject {
	assert.ok(validateSoundscaperProject(value)); return value;
}

export function labelPoints(project: SoundscaperProject) {
	return project.tracks.flatMap(track => {
		if (track.type !== 'label') return [];
		assert.ok(Array.isArray(track.labels));
		return track.labels.map((value: unknown) => {
			assert.ok(value && typeof value === 'object');
			const label = value as Record<string, unknown>;
			assert.ok(typeof label.title === 'string' && typeof label.startFrame === 'number' && typeof label.endFrame === 'number');
			return { trackId: track.id, trackName: track.name, title: label.title, startFrame: label.startFrame, endFrame: label.endFrame };
		});
	});
}

export async function assertLabelArchiveCustody(context: TestContext, { controller, store }: Session,
	check: (project: SoundscaperProject) => void): Promise<void> {
	const current = labelProject(controller.project); check(current);
	await controller.actions.project.flush();
	const reopened = await assertEditedAudioArchiveCustody(context, store, current, []);
	check(reopened);
}

/** Invoke the same production command adapter used by the Edit menu, including its default arguments. */
export function addLabelThroughEdit(controller: Controller): void {
	const issued: unknown[] = [];
	const actions = createAudacityLabelActionRuntime({ getProject: () => labelProject(controller.project),
		hasSelectedClip: () => false, addLabel: controller.actions.labels.add, updateLabel: controller.actions.labels.update,
		issue(type, payload) { issued.push({ type, payload }); }, renameClip() { assert.fail('Label Add must not rename a clip.'); },
	});
	const id = actions.add(); assert.ok(id);
	const point = labelPoints(labelProject(controller.project))[0]; assert.ok(point);
	assert.deepEqual(issued, [{ type: 'edit-label', payload: { trackId: point.trackId, labelId: id } }]);
}

/** Mount the production panel with the actual controller, preserving its explicit null target and title. */
export async function addLabelThroughManager(controller: Controller): Promise<void> {
	const dom = installReactTestDom(), root = createRoot(dom.container as unknown as Element);
	const globals = globalThis as typeof globalThis & { React?: typeof React; IS_REACT_ACT_ENVIRONMENT?: boolean };
	const previousReact = globals.React, previousAct = globals.IS_REACT_ACT_ENVIRONMENT;
	globals.React = React; globals.IS_REACT_ACT_ENVIRONMENT = true;
	try {
		await act(async () => root.render(<WorkspacePanelContent panelId="labels" controller={controller}
			snapshot={controller.getSnapshot()} copy={{ ...COPY, ...ENGLISH_COPY, select: 'Time selection' }} locale="en"
			run={(operation: () => unknown) => operation()} fileService={null} playbackMeterSettings={null}
			showArmControls={false} displayAudioSupported={false} onOpenEffects={() => undefined}
			effectsPanelTarget={null} onEffectWindowChange={() => undefined} blocked={false} />));
		const add = dom.container.querySelectorAll('button').find(button => button.textContent === 'New label'); assert.ok(add);
		assert.equal(reactProps(add).disabled, false);
		const onClick = reactProps(add).onClick; assert.ok(onClick);
		await act(async () => { await onClick(); });
	} finally {
		await act(async () => root.unmount()); dom.restore(); globals.React = previousReact; globals.IS_REACT_ACT_ENVIRONMENT = previousAct;
	}
}
