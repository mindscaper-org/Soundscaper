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
		chooseBatchSaveDirectory: async (request: { suggestedNames?: unknown } = {}) => {
			const names = namesFor(request.suggestedNames ?? [], true);
			const result = await options.invoke(options.channel, { kind: 'macro-file-folder', suggestedNames: names });
			return result === null ? null : directory(result, names.length);
		},
		planBatchSaveOutputs: async (request: { batchId: unknown; suggestedNames: unknown }) => {
			const names = namesFor(request.suggestedNames);
			const result = await options.invoke(options.channel, { kind: 'macro-file-plan', batchId: id(request.batchId), suggestedNames: names });
			return directory(result, names.length);
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

function namesFor(value: unknown, allowEmpty = false): string[] {
	if (!Array.isArray(value) || (!allowEmpty && !value.length) || value.length > 100) throw new RangeError('Invalid batch output count.');
	return value.map(leaf);
}
function directory(result: unknown, count: number) {
	const value = result as { id: unknown; name: unknown; displayPath: unknown; files: unknown };
	if (!value || typeof value.name !== 'string' || typeof value.displayPath !== 'string' || !value.displayPath || value.displayPath.length > 32768
		|| value.displayPath.includes('\0') || !Array.isArray(value.files) || value.files.length !== count) throw new TypeError('Invalid output folder response.');
	return { id: id(value.id), name: value.name, displayPath: value.displayPath, files: value.files.map(leaf) };
}
