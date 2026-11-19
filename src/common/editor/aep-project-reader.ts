/* SPDX-License-Identifier: AGPL-3.0-only */
import { AEP_LIMITS, aepChild, aepFourCC, aepText, aepView, parseAepContainer, type AepChunk } from './aep-container.ts';
import { parseAepxContainer } from './aepx-container.ts';
import { normalizeRational, type Rational } from './timeline-time.ts';
export interface AepNamedNode { readonly name: string; readonly chunk: AepChunk }
export interface AepFootage {
	readonly id: number; readonly name: string; readonly width: number; readonly height: number;
	readonly color: readonly [number, number, number, number] | null; readonly fileName: string | null;
	readonly sequence: boolean; readonly duration: number; readonly frameRate: number; readonly byteLength: number | null;
}
export interface AepLayer {
	readonly id: number; readonly name: string; readonly sourceId: number; readonly parentId: number;
	readonly kind: number; readonly threeD: boolean; readonly nullLayer: boolean; readonly adjustment: boolean;
	readonly enabled: boolean; readonly audioEnabled: boolean; readonly effectsEnabled: boolean; readonly collapse: boolean; readonly solo: boolean;
	readonly start: number; readonly inPoint: number; readonly outPoint: number; readonly stretch: number; readonly blend: number;
	readonly matte: Readonly<{ id: number; mode: number }> | null; readonly properties: readonly AepNamedNode[];
}
export interface AepComposition {
	readonly id: number; readonly name: string; readonly width: number; readonly height: number; readonly pixelAspect: number;
	readonly frameRate: Rational; readonly storedRate: number; readonly timescale: number; readonly durationFrames: number;
	readonly layers: readonly AepLayer[]; readonly workArea: readonly [number, number] | null; readonly motionBlur: boolean;
}
export interface NativeAepDocument { readonly format: 'aep' | 'aepx'; readonly version: string; readonly compositions: readonly AepComposition[]; readonly footage: readonly AepFootage[] }

/** Match names are ordered occurrences, never an object keyed by display names. */
export function aepNamedNodes(group: AepChunk | undefined): readonly AepNamedNode[] {
	const entries: AepNamedNode[] = []; let name: string | null = null;
	for (const chunk of group?.children ?? []) {
		if (chunk.id === 'tdmn') name = aepText(chunk.data);
		else if (chunk.id === 'LIST' && name !== null) { entries.push({ name, chunk }); name = null; }
	}
	return entries;
}
export function aepNamed(entries: readonly AepNamedNode[], name: string): AepChunk | undefined {
	const found = entries.filter(entry => entry.name === name);
	if (found.length > 1) throw new TypeError(`AEP has duplicate property identity ${name}.`); return found[0]?.chunk;
}
export function aepFinite(value: number): number { if (!Number.isFinite(value) || Math.abs(value) > 1e12) throw new RangeError('AEP numeric value is outside its finite range.'); return value; }
function ratio(view: DataView, at: number, signed = true): number {
	const denominator = view.getUint32(at + 4); if (!denominator) throw new RangeError('AEP time has a zero denominator.');
	return aepFinite((signed ? view.getInt32(at) : view.getUint32(at)) / denominator);
}
function label(chunk: AepChunk, fallback: string): string { return aepText(aepChild(chunk, 'Utf8')?.data ?? new Uint8Array()) || fallback; }
function readFootage(item: AepChunk, id: number): AepFootage {
	const pin = aepChild(item, 'Pin '), source = pin && aepChild(pin, 'sspc'), options = pin && aepChild(pin, 'opti');
	if (!source || !options) throw new TypeError('AEP footage source records are missing.');
	const view = aepView(source.data, 46), solid = aepFourCC(source.data, 22) === 'Soli', width = view.getUint32(30), height = view.getUint32(34);
	const opt = aepView(options.data, solid ? 26 : 58);
	let fileName: string | null = null, sequence = false;
	if (!solid) {
		const alias = aepChild(pin!, 'Als2'), raw = alias && aepChild(alias, 'alas');
		if (raw) {
			const value: unknown = JSON.parse(aepText(raw.data));
			if (value !== null && typeof value === 'object') {
				const object = value as Record<string, unknown>, path = object.fullpath;
				if (typeof path === 'string') fileName = path.replaceAll('\\', '/').split('/').at(-1) || null;
				sequence = object.target_is_folder === true || object.target_is_folder === 1 || object.target_is_folder === '1';
			}
		}
	}
	const sourceName = aepText(options.data.subarray(solid ? 26 : 58));
	return { id, name: label(item, sourceName || fileName || `Source ${String(id)}`), width, height, fileName: sequence ? null : (fileName ?? sourceName) || null, sequence,
		color: solid ? [aepFinite(opt.getFloat32(14)), aepFinite(opt.getFloat32(18)), aepFinite(opt.getFloat32(22)), aepFinite(opt.getFloat32(10))] : null,
		duration: ratio(view, 38, false), frameRate: source.data.length >= 60 ? view.getUint32(56) : 0, byteLength: source.data.length >= 212 ? view.getUint32(208) : null };
}
function readLayer(chunk: AepChunk): AepLayer {
	const header = aepChild(chunk, 'ldta'); if (!header) throw new TypeError('AEP layer header is missing.');
	const view = aepView(header.data, 140), id = view.getUint32(0), denominator = view.getUint32(108);
	if (!denominator) throw new RangeError('AEP stretch has a zero denominator.');
	const stretch = view.getInt32(8) / denominator;
	if (Math.abs(stretch) < 0.01 || Math.abs(stretch) > 99) throw new RangeError('AEP stretch is outside the signed 1–9900 percent range.');
	const start = ratio(view, 12), a = start + ratio(view, 20) * stretch, b = start + ratio(view, 28) * stretch;
	if (a === b) throw new RangeError('AEP layer has an empty time range.');
	const flags = header.data[39]!, typeFlags = header.data[38]!;
	return { id, name: label(chunk, ''), sourceId: view.getUint32(40), parentId: view.getUint32(132), kind: view.getUint32(128),
		threeD: Boolean(typeFlags & 4), nullLayer: Boolean(typeFlags & 128), adjustment: Boolean(typeFlags & 2), solo: Boolean(typeFlags & 8),
		enabled: Boolean(flags & 1), audioEnabled: Boolean(flags & 2), effectsEnabled: Boolean(flags & 4), collapse: Boolean(flags & 128),
		start, inPoint: Math.min(a, b), outPoint: Math.max(a, b), stretch, blend: header.data[99]!,
		matte: header.data[107] ? { id: aepView(header.data, 164).getUint32(160), mode: header.data[107]! } : null,
		properties: aepNamedNodes(aepChild(chunk, 'tdgp')) };
}
function readComposition(item: AepChunk, id: number): AepComposition {
	const header = aepChild(item, 'cdta'); if (!header) throw new TypeError('AEP composition header is missing.');
	const view = aepView(header.data, 176), unit = view.getUint32(4), timescale = view.getUint32(8), duration = view.getUint32(44);
	if (!unit || !timescale || !duration) throw new RangeError('AEP composition clock is invalid.');
	const storedRate = timescale / unit;
	let frameRate = normalizeRational({ num: timescale, den: unit });
	for (const num of [24000, 30000, 48000, 60000, 120000]) if (Math.abs(num / 1001 - storedRate) < 0.0005) frameRate = { num, den: 1001 };
	const durationFrames = duration / unit;
	if (!Number.isInteger(durationFrames) || durationFrames > 100_000_000 || storedRate < 1 || storedRate > 1000) throw new RangeError('AEP composition exceeds the frame clock admission.');
	const denominator = view.getUint32(148); if (!denominator) throw new RangeError('AEP pixel aspect is invalid.');
	const begin = view.getUint32(28) / unit, end = view.getUint32(36) / unit;
	return { id, name: label(item, `Composition ${String(id)}`), width: view.getUint16(140), height: view.getUint16(142), pixelAspect: view.getUint32(144) / denominator,
		frameRate, storedRate, timescale, durationFrames, motionBlur: Boolean(header.data[139]! & 8),
		workArea: end !== 0xffffffff / unit && begin >= 0 && end > begin && end <= durationFrames ? [begin, end] : null,
		layers: (item.children ?? []).filter(child => child.type === 'Layr').map(readLayer) };
}
export function readNativeAep(input: Uint8Array, signal?: AbortSignal): NativeAepDocument {
	const binary = input.length >= 4 && aepFourCC(input) === 'RIFX', chunks = binary ? parseAepContainer(input, signal) : parseAepxContainer(input, signal);
	const roots = chunks.filter(chunk => chunk.type === 'Fold'), root = roots[0];
	if (roots.length !== 1 || !root?.children) throw new TypeError('AEP project item tree is missing, duplicated or unreadable.');
	const compositions: AepComposition[] = [], footage: AepFootage[] = [], ids = new Set<number>(); let count = 0, layers = 0;
	function folder(container: AepChunk): void {
		for (const item of container.children ?? []) {
			signal?.throwIfAborted(); if (item.type !== 'Item') continue;
			if (++count > AEP_LIMITS.items) throw new RangeError('AEP project item budget exceeded.');
			const header = aepChild(item, 'idta'); if (!header) throw new TypeError('AEP item header is missing.');
			const view = aepView(header.data, 20), id = view.getUint32(16), kind = view.getUint16(0);
			if (!id || ids.has(id)) throw new TypeError('AEP item identities must be unique and nonzero.'); ids.add(id);
			if (kind === 1) { const children = aepChild(item, 'Sfdr'); if (children) folder(children); }
			else if (kind === 4) { const comp = readComposition(item, id); compositions.push(comp); layers += comp.layers.length; }
			else if (kind === 7) footage.push(readFootage(item, id));
			else throw new TypeError(`AEP item type ${String(kind)} is not decoded.`);
			if (layers > AEP_LIMITS.layers) throw new RangeError('AEP project layer budget exceeded.');
		}
	}
	folder(root); if (!compositions.length) throw new TypeError('AEP contains no compositions.');
	const head = chunks.find(chunk => chunk.id === 'head');
	return { format: binary ? 'aep' : 'aepx', version: head && head.data.length >= 8 ? `0x${aepView(head.data, 8).getUint32(4).toString(16)}` : 'unknown', compositions, footage };
}
