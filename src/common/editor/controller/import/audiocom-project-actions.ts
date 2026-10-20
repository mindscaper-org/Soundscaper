/* SPDX-License-Identifier: AGPL-3.0-only */
import type { SaveAup4Options } from '../document/native-project-types.ts';
import type { AudiocomPanelSession } from './audiocom-panel-session.ts';
import type { AudiocomProjectArchives } from './audiocom-project-archives.ts';

interface ProjectController {
	getSnapshot(): { readonly project?: { readonly id: string; readonly title: string } | null };
	readonly actions: {
		readonly project?: {
			readonly saveAup3?: (options: SaveAup4Options) => Promise<unknown>;
		};
		readonly export?: { readonly start: (settings: Record<string, unknown>) => Promise<unknown> };
	};
}

function projectController(owner: object): ProjectController {
	const controller = owner as Partial<ProjectController>;
	if (!controller.getSnapshot || !controller.actions) throw new Error('Open a project first.');
	return controller as ProjectController;
}

/** Render into the ordinary publication queue on browser and desktop alike. */
export async function enqueueAudiocomProjectAudio(owner: object, session: AudiocomPanelSession): Promise<string | undefined> {
	const controller = projectController(owner);
	const project = controller.getSnapshot().project;
	const auth = session.getSnapshot().auth;
	if (!project || auth.status !== 'connected' || !controller.actions.export) return;
	let queuedId: string | undefined;
	await controller.actions.export.start({
		format: 'wav', mode: 'mixdown', sampleFormat: 'int16', range: 'project', maximumOutputBytes: 100000000,
		saveToFile: (request: Readonly<Record<string, unknown>>) => {
			if (controller.getSnapshot().project?.id !== project.id || session.getSnapshot().auth !== auth) {
				throw new DOMException('The project or audio.com account changed.', 'AbortError');
			}
			if (!(request.blob instanceof Blob)) throw new Error('The audio export is unavailable.');
			queuedId = session.enqueueFiles([new File([request.blob], String(request.suggestedName), { type: request.blob.type })])[0];
			return Promise.resolve({ method: 'audiocom-queue', fileName: request.suggestedName });
		},
	});
	return queuedId;
}

/** The archive coordinator owns revision identity and account cancellation. */
export async function saveAudiocomEditorProject(owner: object, archives: AudiocomProjectArchives): Promise<void> {
	const controller = projectController(owner);
	const project = controller.getSnapshot().project;
	if (!project) return;
	await archives.saveProject(project.id, async (_format, signal) => {
		let file: File | undefined;
		const save = controller.actions.project?.saveAup3;
		if (!save) throw new Error('Project saving is unavailable.');
		await save({ saveCopy: true, useFileSystemAccess: false, fileName: project.title,
			saveFile: async request => {
				signal.throwIfAborted(); request.signal.throwIfAborted();
				if (controller.getSnapshot().project?.id !== project.id) throw new DOMException('The project changed.', 'AbortError');
				file = new File([request.blob], request.suggestedName, { type: request.mimeType });
				return { method: 'audiocom-archive' };
			},
		});
		signal.throwIfAborted();
		if (!file) throw new Error('The project could not be prepared for saving.');
		return file;
	});
}
