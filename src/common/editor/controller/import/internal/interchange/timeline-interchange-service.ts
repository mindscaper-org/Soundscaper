/* SPDX-License-Identifier: AGPL-3.0-only */

import { setLocalizedStatus } from '../../../../../i18n/presentation-message.ts';
import { desktopReadCapabilityIdFor } from '../../../../desktop-read-capability-registry.ts';
import { isTimelineInterchangeFile } from '../../../../timeline-interchange-file.ts';
import { parseTimelineInterchange } from '../../../../timeline-interchange-import.ts';
import { buildTimelineInterchangeProject } from '../../../../timeline-interchange-project.ts';
import { createCurrentAudioEditorProject } from '../../../../project-current.ts';
import type { NativeProjectServiceRuntime, NativeProjectDocument, NativeProjectFile } from '../../../document/native-project-types.ts';
import type { SesxServiceHelpers } from '../sesx/sesx-service.ts';
import { timelineInterchangeMediaName, type TimelineInterchangeMedia } from '../../../../timeline-interchange-types.ts';
import { decodeBomMarkedUtf16 } from '../../../../bom-marked-text.ts';
import { stageTimelineInterchangeMedia } from './timeline-interchange-media.ts';
import type { TimelineInterchangeFinalizer } from './timeline-interchange-video.ts';

const MAXIMUM_TEXT_BYTES = 32 * 1024 * 1024;
const MAXIMUM_OMF_BYTES = 512 * 1024 * 1024;

export interface TimelineInterchangeOpenOptions {
	readonly mediaFiles?: readonly File[];
	readonly edlRate?: Readonly<{ num: number; den: number }>;
}

export function createTimelineInterchangeService(runtime: NativeProjectServiceRuntime, helpers: SesxServiceHelpers) {
	return Object.freeze({ openInterchange });

	async function openInterchange(file: NativeProjectFile, options: TimelineInterchangeOpenOptions = {}) {
		if (!file || !isTimelineInterchangeFile(file.name)) throw new TypeError('Choose an EDL, OTIO, FCPXML, or OMF file.');
		if (runtime.editingBlocked()) return undefined;
		const operation = helpers.beginProjectTask('timeline-interchange-open');
		const signal = operation.task.signal;
		const assertCurrent = () => helpers.assertOwnership(operation.task, operation.projectToken);
		const sessionReadId = desktopReadCapabilityIdFor(file);
		const persisted: string[] = [];
		const finalizers: TimelineInterchangeFinalizer[] = [];
		let imported: NativeProjectDocument | null = null;
		let activated = false;
		helpers.beginImport(operation.task);
		try {
			setLocalizedStatus(runtime.setStatus, runtime.copy, 'importing');
			const binary = /\.omfi?$/iu.test(file.name);
			if (file.size > (binary ? MAXIMUM_OMF_BYTES : MAXIMUM_TEXT_BYTES)) throw new RangeError('The interchange document exceeds its import size limit.');
			const document = binary
				? (await import('../../../../omf-import.ts')).parseOmfDocument(new Uint8Array(await file.arrayBuffer()))
				: parseTimelineInterchange(file.name, await readTimelineText(file), { edlRate: options.edlRate });
			assertCurrent();
			const media = new Map<string, Readonly<Record<string, unknown>>>();
			const stagedSourceIds = new Map<string, string>();
			let mediaRootId: string | undefined;
			let folderRequested = false;
			for (const reference of document.media) {
				assertCurrent();
				const consume = async (blob: Blob, name = reference.name): Promise<void> => {
					const decoded = await stageTimelineInterchangeMedia(runtime, helpers, operation, { ...reference, name }, blob, persisted, finalizers);
					if (decoded) { media.set(reference.id, decoded); stagedSourceIds.set(reference.id, String(decoded.id)); }
				};
				const selected = companionFor(reference, options.mediaFiles ?? []);
				if (reference.blob) await consume(reference.blob);
				else if (selected) await consume(selected, selected.name);
				else if (sessionReadId && runtime.fileService.resolveSesxMedia && runtime.fileService.withReadDescriptors) {
					const path = lookupPath(reference);
					if (!path) continue;
					const resolve = async () => {
						let result = await runtime.fileService.resolveSesxMedia!({ sessionReadId, relativePath: path, ...(mediaRootId ? { mediaRootId } : {}) });
						assertCurrent();
						for (const alias of reference.aliases ?? []) {
							if (result.status === 'found' || !safeBasename(alias) || alias === path) continue;
							result = await runtime.fileService.resolveSesxMedia!({ sessionReadId, relativePath: alias, ...(mediaRootId ? { mediaRootId } : {}) });
							assertCurrent();
						}
						return result;
					};
					let resolved = await resolve();
					assertCurrent();
					if (resolved.status !== 'found' && !folderRequested && runtime.fileService.chooseSesxMediaFolder) {
						folderRequested = true;
						const folder = await runtime.fileService.chooseSesxMediaFolder({ sessionReadId });
						assertCurrent();
						if (folder.status === 'selected') mediaRootId = folder.mediaRootId;
					}
					if (resolved.status !== 'found' && mediaRootId) {
						resolved = await resolve();
						assertCurrent();
					}
					if (resolved.status === 'found') {
						const descriptor = resolved.descriptor;
						await runtime.fileService.withReadDescriptors([descriptor], { signal }, async files => {
							if (files[0]) await consume(files[0], descriptor.name);
						});
					}
				}
			}
			assertCurrent();
			const plan = buildTimelineInterchangeProject(document, { fileName: file.name, createStableId: runtime.createStableId, media, stagedSourceIds });
			if (runtime.createImportedProject) imported = await runtime.createImportedProject(plan.project);
			else {
				const created = createCurrentAudioEditorProject(plan.project as never);
				imported = runtime.adaptAudacityProject ? await runtime.adaptAudacityProject(created) : runtime.loadProject(created).project;
			}
			assertCurrent();
			await runtime.switchProject(imported, { readOnly: false, save: true });
			activated = true;
			operation.task.assertCurrent();
			runtime.projectGeneration.capture(imported.id);
			runtime.state.deliveryReport = plan.report;
			setLocalizedStatus(runtime.setStatus, runtime.copy, 'ui.interchange.imported', undefined, 'success', {
				fallback: 'Timeline imported. Review File > Delivery Report for conversions and missing media.',
			});
			runtime.publishDocumentSnapshot();
			return Object.freeze({ project: imported, report: plan.report });
		} catch (error) {
			if (!activated && (!imported || runtime.getProject()?.id !== imported.id)) {
				for (const id of persisted) await Promise.resolve(runtime.store.deleteSource(id)).catch(() => undefined);
			}
			throw error;
		} finally {
			try {
				const retained = activated || (imported !== null && runtime.getProject()?.id === imported.id);
				const cleanup = await Promise.allSettled(finalizers.map(finalize => Promise.resolve().then(() => finalize(retained))));
				const failed = cleanup.filter(result => result.status === 'rejected');
				if (failed.length) setLocalizedStatus(runtime.setStatus, runtime.copy, 'ui.interchange.cleanupFailed', undefined, 'error', { fallback: 'Interchange media cleanup failed.' });
			} finally {
				helpers.finishImport(operation.task);
				operation.task.finish();
				if (sessionReadId) await runtime.fileService.releaseSesxSession?.(sessionReadId);
			}
		}
	}
}

function companionFor(reference: TimelineInterchangeMedia, files: readonly File[]): File | null {
	const basename = timelineInterchangeMediaName(reference.path);
	const matches = files.filter(file => file.name === reference.name || file.name === reference.path || file.name === basename || reference.aliases?.includes(file.name));
	return matches.length === 1 ? matches[0]! : null;
}

function lookupPath(reference: TimelineInterchangeMedia): string | null {
	let path = reference.path.replaceAll('\\', '/');
	try { if (path.startsWith('file:')) path = decodeURIComponent(new URL(path).pathname); } catch { return null; }
	const parts = path.split('/').filter(part => part !== '.');
	if (path.length <= 4096 && !path.startsWith('/') && !/^[a-z]:/iu.test(path) && !path.includes('://') && parts.length <= 32
		&& parts.every(safeBasename)) return parts.join('/');
	const basename = timelineInterchangeMediaName(path);
	return safeBasename(basename) ? basename : safeBasename(reference.name) ? reference.name : null;
}

async function readTimelineText(file: NativeProjectFile): Promise<string> {
	const prefix = new Uint8Array(await file.slice(0, 2).arrayBuffer());
	if ((prefix[0] === 0xff && prefix[1] === 0xfe) || (prefix[0] === 0xfe && prefix[1] === 0xff)) {
		return decodeBomMarkedUtf16(await file.arrayBuffer()) ?? file.text();
	}
	return file.text();
}

function safeBasename(value: string): boolean {
	return Boolean(value) && !/[\\/]/u.test(value) && value !== '.' && value !== '..' && value.length <= 255
		&& !/^[a-z]:/iu.test(value) && !Array.from(value).some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127);
}
