/* SPDX-License-Identifier: AGPL-3.0-only */

import type { ProjectFileAssociations } from './project-file-associations.ts';
import type { TemporaryProjectStorage } from './temporary-project-storage.ts';

interface Options {
	readonly handle: (channel: string, handler: (event: unknown, value: unknown) => unknown) => void;
	readonly ownerFor: (event: unknown) => object;
	readonly channels: Readonly<Record<string, string>>;
	readonly files: ProjectFileAssociations;
	readonly storage: TemporaryProjectStorage;
	readonly chooseFolder: (defaultPath: string) => Promise<string | null>;
	readonly prompt: (options: Readonly<{ title: string; message: string; buttons: string[]; defaultId: number; cancelId: number; type: 'question'; noLink: boolean }>) => Promise<{ response: number }>;
}
export function registerProjectSavingIpc(d: Options): void {
	const register = (name: string, operation: (owner: object, value: unknown) => unknown) => {
		const channel = d.channels[name]; if (!channel) throw new Error(`Missing project saving channel ${name}`);
		d.handle(channel, (event, value) => operation(d.ownerFor(event), value));
	};
	register('rememberProjectFile', (owner, value) => {
		const row = value as { projectId?: unknown; originalId?: unknown; baseline?: unknown };
		return d.files.remember(text(row.projectId, 256), text(row.originalId, 48), text(row.baseline, 64), owner);
	});
	register('restoreProjectFile', (owner, value) => d.files.restore(text(value, 256), owner));
	register('temporaryDataStatus', () => d.storage.status());
	register('chooseTemporaryDataFolder', async () => {
		const selected = await d.chooseFolder(d.storage.status().selectedFolder);
		return selected ? d.storage.select(selected) : d.storage.status();
	});
	register('confirmProjectSave', async (_owner, value) => {
		const row = value as Record<string, unknown>;
		const result = await d.prompt({ type: 'question', title: text(row.title, 200), message: text(row.message, 1000),
			buttons: [text(row.save, 100), text(row.discard, 100), text(row.cancel, 100)], defaultId: 0, cancelId: 2, noLink: true });
		return ['save', 'discard', 'cancel'][result.response] ?? 'cancel';
	});
}
function text(value: unknown, maximum: number): string {
	if (typeof value !== 'string' || !value || value.length > maximum || value.includes('\0')) throw new TypeError('Invalid project saving request');
	return value;
}
