/* SPDX-License-Identifier: AGPL-3.0-only */

import { mkdir } from 'node:fs/promises';
import { extname, join } from 'node:path';

import { ACCEPTED_PROJECT_FILE_EXTENSIONS, PROJECT_FILE_EXTENSION } from './constants.js';
import { throwAfterReadCapabilityRollback, createMacroBatchSaveRequestHandler } from './file-capabilities.js';
import { redispatchPendingProjectsAfterReadRelease } from './file-associations.js';
import { registerSelectedReadCapability } from './read-selection-service.js';
import { acceptsFile, validateFileChoice, validateSaveChoice } from './validation.js';

/** @typedef {{id: string, name: string}} OriginalFileDescriptor */
/**
 * @typedef {object} OriginalFileCapabilityService
 * @property {(id: string, options: {owner: object}) => Promise<OriginalFileDescriptor | null>} registerRead
 * @property {(id: string, options: {owner: object; allowProjectSavePicker?: true}) => Promise<OriginalFileDescriptor | null>} prepare
 * @property {(id: string, options: {owner: object}) => boolean} release
 * @property {(path: string, options: {owner: object; copySourceId?: string}) => Promise<OriginalFileDescriptor & {originalFile: OriginalFileDescriptor}>} registerProjectSave
 * @property {(readId: string, options: {owner: object}) => Promise<string>} protectCopySource
 */

// Save purposes that write a project rather than exporting something out of one.
const SAVE_DIALOG_TITLES = new Map([
	['project', 'Save project'],
	['project-copy', 'Save project copy'],
	['aup3', 'Export Audacity 3 project'],
	['aup4', 'Export Audacity interchange'],
	['audacity-recovery', 'Save repaired Audacity copy'],
]);

function acceptedProjectSuffix(path) {
	const suffix = extname(path).toLowerCase();
	return ACCEPTED_PROJECT_FILE_EXTENSIONS.includes(suffix) ? suffix : null;
}

/**
 * The renderer's file surface: the two native choosers and the capability-scoped reads and
 * writes they hand out.
 *
 * Every handler here is defined by the same rule — the renderer never names a path, it
 * receives an opaque capability the main process minted from a dialog the user answered —
 * so they register together, away from the composition root that owns the window lifecycle.
 */
export function registerFileCapabilityIpc({
	channels, desktopSmokeProbe, dialog, handle, opaqueId, ownerFor, pendingOpenProjects,
	readCapabilities, saves, saveTargets, originalFiles = /** @type {OriginalFileCapabilityService | null} */ (null), sesxMediaSessions = null, windowFor,
	projectDirectory = /** @type {(() => Promise<string | null>) | null} */ (null),
}) {
	const macroBatchSave = createMacroBatchSaveRequestHandler({ targets: saveTargets, chooseDirectory: async () => {
		const result = await dialog.showOpenDialog(windowFor(), { title: 'Macro output folder', properties: ['openDirectory', 'createDirectory'] });
		return result.canceled ? null : result.filePaths[0] ?? null;
	} });
	async function chooseFiles(event, value) {
		const owner = ownerFor(event);
		const choice = validateFileChoice(value);
		const smokeFilePaths = desktopSmokeProbe.resolveOpenPaths(choice);
		const result = smokeFilePaths !== null ? { canceled: false, filePaths: smokeFilePaths }
			: await dialog.showOpenDialog(windowFor(), {
				title: choice.purpose === 'project' ? 'Open file' : 'Import files',
				properties: choice.multiple ? ['openFile', 'multiSelections'] : ['openFile'], filters: choice.filters,
			});
		if (result.canceled) return [];
		const descriptors = [];
		try {
			for (const filePath of result.filePaths) {
				if (!acceptsFile(choice.purpose, filePath)) throw new TypeError('The selected file type is not allowed');
				const descriptor = await registerSelectedReadCapability(readCapabilities, filePath, { owner, purpose: choice.purpose, originalFiles });
				descriptors.push(descriptor);
				if (['project', 'media'].includes(choice.purpose) && /\.(?:sesx?|edl|otio|fcpxml|omfi?|aaf|adl|ardour|scraftz?|pt[fxs]|nhsx|rpp)$/iu.test(filePath)) await sesxMediaSessions?.registerSelection(descriptor.id, filePath, { owner });
			}
			return descriptors;
		} catch (error) {
			for (const descriptor of descriptors) if (descriptor.originalFile) originalFiles?.release(descriptor.originalFile.id, { owner });
			for (const descriptor of descriptors) sesxMediaSessions?.release(descriptor.id, { owner });
			await throwAfterReadCapabilityRollback(readCapabilities, descriptors, owner, error);
		}
	}

	async function chooseSaveTarget(event, value) {
		const owner = ownerFor(event);
		if (typeof value?.kind === 'string' && value.kind.startsWith('macro-file-')) return macroBatchSave(owner, value);
		if (value?.kind === 'protect-project-copy-source') {
			if (!originalFiles) throw new Error('Project copy source protection is unavailable.');
			return originalFiles.protectCopySource(opaqueId(value.readId, 64), { owner });
		}
		const choice = validateSaveChoice(value);
		const copySourceId = value?.projectCopySourceId === undefined ? null : opaqueId(value.projectCopySourceId, 48);
		if (copySourceId && (choice.purpose !== 'project-copy' || !originalFiles)) throw new TypeError('A protected project-copy destination is required.');
		const register = async (path) => {
			if (copySourceId && originalFiles) return originalFiles.registerProjectSave(path, { owner, copySourceId });
			if (choice.purpose === 'audacity-recovery') await readCapabilities.assertRecoveryOutputPath(path, { owner });
			return originalFiles && choice.purpose === 'project' && acceptedProjectSuffix(path)
				? originalFiles.registerProjectSave(path, { owner }) : saveTargets.registerPath(path, { owner, purpose: choice.purpose,
					...(choice.purpose === 'audacity-recovery' ? { beforeCommit: () => readCapabilities.assertRecoveryOutputPath(path, { owner }) } : {}) });
		};
		const smokeFilePath = await desktopSmokeProbe.resolveSavePath(choice);
		if (smokeFilePath !== null) {
			return register(smokeFilePath);
		}
		const projectSuffix = choice.purpose === 'project' ? PROJECT_FILE_EXTENSION
			: choice.purpose === 'project-copy' ? acceptedProjectSuffix(choice.suggestedName) ?? PROJECT_FILE_EXTENSION : null;
		let defaultPath = projectSuffix && !acceptedProjectSuffix(choice.suggestedName)
			? `${choice.suggestedName}${projectSuffix}` : choice.suggestedName;
		if (projectDirectory && SAVE_DIALOG_TITLES.has(choice.purpose)) {
			const directory = await projectDirectory();
			if (directory) {
				try {
					await mkdir(directory, { recursive: true, mode: 0o700 });
					defaultPath = join(directory, defaultPath);
				} catch {
					// An unavailable default directory must not prevent choosing another location.
				}
			}
		}
		for (;;) {
			const result = await dialog.showSaveDialog(windowFor(), {
				title: SAVE_DIALOG_TITLES.get(choice.purpose) ?? 'Export',
				defaultPath,
				filters: choice.filters,
			});
			if (result.canceled || !result.filePath) return null;
			if (!projectSuffix || acceptedProjectSuffix(result.filePath)) return register(result.filePath);
			// The native dialog must confirm the corrected name and any overwrite.
			if (ownerFor(event) !== owner) return null;
			defaultPath = `${result.filePath}${projectSuffix}`;
		}
	}

	handle(channels.chooseFiles, (event, value) => chooseFiles(event, value));
	handle(channels.releaseRead, (event, value) => {
		const owner = ownerFor(event);
		const id = opaqueId(value, 64);
		sesxMediaSessions?.release(id, { owner });
		return redispatchPendingProjectsAfterReadRelease(pendingOpenProjects, readCapabilities.release(id, { owner }));
	});
	if (sesxMediaSessions) {
		handle(channels.sesxResolveMedia, (event, value) => sesxMediaSessions.resolve({
			owner: ownerFor(event), sessionReadId: opaqueId(value?.sessionReadId, 64),
			relativePath: value?.relativePath,
			...(value?.mediaRootId === undefined ? {} : { mediaRootId: opaqueId(value.mediaRootId, 48) }),
		}));
		handle(channels.sesxChooseFolder, (event, value) => sesxMediaSessions.chooseFolder({
			owner: ownerFor(event), sessionReadId: opaqueId(value?.sessionReadId, 64),
		}));
		handle(channels.sesxReleaseSession, (event, id) => sesxMediaSessions.release(opaqueId(id, 64), { owner: ownerFor(event) }));
	}
	handle(channels.chooseSaveTarget, (event, value) => chooseSaveTarget(event, value));
	handle(channels.releaseSaveTarget, (event, id) => saveTargets.release(opaqueId(id, 48), { owner: ownerFor(event) }));
	if (originalFiles) {
		handle(channels.prepareOriginalOverwrite, (event, value) => {
			const owner = ownerFor(event);
			if (value && typeof value === 'object' && Reflect.ownKeys(value).length === 2
				&& Object.hasOwn(value, 'id') && Object.hasOwn(value, 'allowProjectSavePicker') && value.allowProjectSavePicker === true) {
				return originalFiles.prepare(opaqueId(value.id, 48), { owner, allowProjectSavePicker: true });
			}
			return originalFiles.prepare(opaqueId(value, 48), { owner });
		});
		handle(channels.releaseOriginalFile, (event, id) => originalFiles.release(opaqueId(id, 48), { owner: ownerFor(event) }));
	}
	handle(channels.beginWrite, (event, value) => saves.begin({
		owner: ownerFor(event),
		targetId: opaqueId(value?.targetId, 48),
		size: value?.size,
		maximumSize: value?.maximumSize,
		finalPrefixByteLength: value?.finalPrefixByteLength,
	}));
	handle(channels.writeChunk, (event, value) => saves.writeChunk({ owner: ownerFor(event), writeId: opaqueId(value?.writeId, 32), offset: value?.offset, bytes: value?.bytes }));
	handle(channels.patchFinalPrefix, (event, value) => saves.patchFinalPrefix({ owner: ownerFor(event), writeId: opaqueId(value?.writeId, 32), bytes: value?.bytes }));
	handle(channels.finishWrite, (event, id) => saves.finish(opaqueId(id, 32), { owner: ownerFor(event) }));
	handle(channels.abortWrite, (event, id) => saves.abort(opaqueId(id, 32), { owner: ownerFor(event) }));
}
