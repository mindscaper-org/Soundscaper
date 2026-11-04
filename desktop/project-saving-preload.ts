/* SPDX-License-Identifier: AGPL-3.0-only */
interface Ipc { invoke(channel: string, value?: unknown): Promise<unknown>; send(channel: string, value: unknown): void }
interface Helpers {
	opaqueId(value: unknown, length: number): string;
	original(value: unknown): unknown;
	boolean(value: unknown): boolean;
}
const prefix = 'soundscaper:v1:project-saving:';
export function createProjectSavingPreload(ipc: Ipc, helpers: Helpers) {
	return Object.freeze({
		respondToClose: (value: { requestId: string; allow: boolean }) => ipc.send('soundscaper:v1:close:respond', { requestId: text(value?.requestId, 64), allow: value?.allow === true }),
		prepareOriginalOverwrite: (id: string) => ipc.invoke('soundscaper:v1:original-file:prepare-overwrite', helpers.opaqueId(id, 48)).then(helpers.original),
		releaseOriginalFile: (id: string) => ipc.invoke('soundscaper:v1:original-file:release', helpers.opaqueId(id, 48)).then(helpers.boolean),
		releaseSaveTarget: (id: string) => ipc.invoke('soundscaper:v1:save:release-target', helpers.opaqueId(id, 48)).then(helpers.boolean),
		rememberProjectFile: (value: { projectId: string; originalId: string; baseline: string }) => ipc.invoke(`${prefix}rememberProjectFile`, {
			projectId: text(value?.projectId, 256), originalId: helpers.opaqueId(value?.originalId, 48), baseline: digest(value?.baseline),
		}),
		restoreProjectFile: (id: string) => ipc.invoke(`${prefix}restoreProjectFile`, text(id, 256)).then(value => {
			if (value === null) return null;
			const row = record(value, ['baseline', 'originalFile']);
			return Object.freeze({ baseline: digest(row.baseline), originalFile: row.originalFile === null ? null : helpers.original(row.originalFile) });
		}),
		temporaryDataStatus: () => ipc.invoke(`${prefix}temporaryDataStatus`).then(folderStatus),
		chooseTemporaryDataFolder: () => ipc.invoke(`${prefix}chooseTemporaryDataFolder`).then(folderStatus),
		confirmProjectSave: (value: Record<string, unknown>) => {
			const row = record(value, ['title', 'message', 'save', 'discard', 'cancel']);
			return ipc.invoke(`${prefix}confirmProjectSave`, Object.fromEntries(Object.entries(row).map(([key, value]) => [key, text(value, key === 'message' ? 1000 : 200)])))
				.then(value => value === 'save' || value === 'discard' ? value : 'cancel');
		},
	});
}
function folderStatus(value: unknown) {
	const row = record(value, ['folder', 'selectedFolder', 'restartRequired']);
	if (typeof row.restartRequired !== 'boolean') throw new TypeError('Invalid temporary folder status');
	return Object.freeze({ folder: text(row.folder, 4096), selectedFolder: text(row.selectedFolder, 4096), restartRequired: row.restartRequired });
}
function record(value: unknown, fields: readonly string[]): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Reflect.ownKeys(value).length !== fields.length || fields.some(key => !Object.hasOwn(value, key))) throw new TypeError('Invalid project saving record');
	return value as Record<string, unknown>;
}
function text(value: unknown, maximum: number): string {
	if (typeof value !== 'string' || !value || value.length > maximum || value.includes('\0')) throw new TypeError('Invalid project saving text');
	return value;
}
function digest(value: unknown): string { if (typeof value !== 'string' || !/^[a-f0-9]{64}$/u.test(value)) throw new TypeError('Invalid project file baseline'); return value; }
