/* SPDX-License-Identifier: AGPL-3.0-only */

interface Options {
	invoke(channel: string, request: unknown): Promise<unknown>;
	readonly channel: string;
	text(value: unknown, maximum: number): string;
}

/** Ordinary and batch save pickers share the existing capability IPC channel. */
export function createSaveTargetPreload(options: Options) {
	return {
		chooseSaveTarget: (request: { purpose?: unknown; suggestedName?: unknown }) => options.invoke(options.channel, {
			purpose: options.text(request?.purpose, 24), suggestedName: options.text(request?.suggestedName, 220),
		}),
		chooseBatchSaveDirectory: async (request: { suggestedNames?: unknown }) => {
			const names = request?.suggestedNames;
			if (!Array.isArray(names) || !names.length || names.length > 100) throw new RangeError('Invalid batch output count.');
			const result = await options.invoke(options.channel, { kind: 'macro-file-folder', suggestedNames: names.map(leaf) });
			if (result === null) return null;
			const value = result as { id: unknown; name: unknown; files: unknown };
			if (!value || typeof value.name !== 'string' || !Array.isArray(value.files) || value.files.length !== names.length) throw new TypeError('Invalid output folder response.');
			return { id: id(value.id), name: value.name, files: value.files.map(leaf) };
		},
		prepareBatchSaveTarget: async (request: { batchId: unknown; index: unknown }) => {
			if (!Number.isSafeInteger(request.index) || Number(request.index) < 0 || Number(request.index) >= 100) throw new RangeError('Invalid output index.');
			const result = await options.invoke(options.channel, { kind: 'macro-file-target', batchId: id(request.batchId), index: request.index }) as { id: unknown; name: unknown };
			return { id: id(result?.id), name: leaf(result?.name) };
		},
		releaseBatchSaveDirectory: (batchId: unknown) => options.invoke(options.channel, { kind: 'macro-file-release', batchId: id(batchId) }),
	};
}
function id(value: unknown): string {
	if (typeof value !== 'string' || !/^[a-f0-9]{48}$/u.test(value)) throw new TypeError('Invalid output capability.');
	return value;
}
function leaf(value: unknown): string {
	if (typeof value !== 'string' || !value || value.length > 220 || [...value].some(character => character.charCodeAt(0) < 32) || /[/\\]/u.test(value)) throw new TypeError('Invalid output file name.');
	return value;
}
