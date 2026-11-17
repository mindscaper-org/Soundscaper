/* SPDX-License-Identifier: AGPL-3.0-only */
interface Row { readonly [key: string]: unknown }
export interface MsiPayloadFile { readonly id: string; readonly path: string; readonly size: number }

/** Reconstruct installed paths from read-only MSI tables, never from cabinet entry names. */
export function planMsiPayload(value: unknown, productName: string): { readonly files: readonly MsiPayloadFile[]; readonly cabinetCount: number } {
	const data = record(value);
	const directories = new Map(rows(data.directories).map(row => [text(row.id), row]));
	const application = directories.get('APPLICATIONFOLDER');
	if (!['Soundscaper', 'Framescaper'].includes(productName) || !application || application.parent !== 'ProgramFiles64Folder'
		|| text(application.name).split('|').at(-1) !== productName) throw new Error('MSI must install into its per-machine product directory.');
	const components = new Map(rows(data.components).map(row => [text(row.id), text(row.directory)]));
	const cabinets = rows(data.cabinets);
	if (!cabinets.length || cabinets.length > 256 || cabinets.some(row => !/^#[A-Za-z0-9_.-]+$/u.test(text(row.cabinet)))) {
		throw new Error('MSI must contain bounded embedded cabinets.');
	}
	function directoryPath(id: string, ancestors = new Set<string>()): string[] {
		if (id === 'APPLICATIONFOLDER') return [];
		if (ancestors.has(id) || ancestors.size > 64) throw new Error('Cyclic MSI directory table.');
		ancestors.add(id);
		const row = directories.get(id);
		if (!row) throw new Error('MSI payload escapes its application directory.');
		const name = text(row.name).split(':')[0]!.split('|').at(-1)!;
		return [...directoryPath(text(row.parent), ancestors), ...(name === '.' ? [] : [segment(name)])];
	}
	const ids = new Set<string>(), paths = new Set<string>();
	const files = rows(data.files).map(row => {
		const id = segment(text(row.id)), component = components.get(text(row.component));
		if (!component || ids.has(id)) throw new Error('Invalid or duplicate MSI file identity.');
		ids.add(id);
		const name = segment(text(row.name).split('|').at(-1)!);
		const path = [...directoryPath(component), name].join('/');
		const key = path.toLowerCase();
		if (paths.has(key)) throw new Error('Duplicate MSI installed path.');
		paths.add(key);
		const size = Number(row.size);
		if (!Number.isSafeInteger(size) || size < 0 || size > 8 * 1024 ** 3) throw new Error('Invalid MSI payload size.');
		return { id, path, size };
	});
	if (!files.length || files.reduce((total, file) => total + file.size, 0) > 32 * 1024 ** 3) throw new Error('MSI payload exceeds its size limits.');
	return { files, cabinetCount: cabinets.length };
}

function segment(value: string): string {
	if (!value || value === '.' || value === '..' || [...value].some(character => character.charCodeAt(0) < 32)
		|| /[\\/:*?"<>|]/u.test(value) || /[. ]$/u.test(value)) throw new Error('Invalid MSI payload path.');
	return value;
}
function text(value: unknown): string {
	if (typeof value !== 'string' || value.length > 4096) throw new Error('Invalid MSI table field.');
	return value;
}
function record(value: unknown): Row {
	if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid MSI database projection.');
	return value as Row;
}
function rows(value: unknown): Row[] {
	if (!Array.isArray(value) || value.length > 100_000) throw new Error('Invalid MSI database table.');
	return value.map(record);
}
