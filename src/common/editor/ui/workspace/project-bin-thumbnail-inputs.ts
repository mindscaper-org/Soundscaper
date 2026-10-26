/* SPDX-License-Identifier: AGPL-3.0-only */
type Row = Readonly<Record<string, unknown>>;
interface Presentation { readonly value: Row; readonly index: number }
const EMPTY: readonly unknown[] = Object.freeze([]);
const owners = new WeakMap<readonly unknown[], ReadonlyMap<string, readonly Presentation[]>>();
const masks = new WeakMap<readonly unknown[], ReadonlyMap<unknown, Row>>();
const record = (value: unknown): Row => value && typeof value === 'object' && !Array.isArray(value) ? value as Row : {};
const array = (value: unknown): readonly unknown[] => Array.isArray(value) ? value : EMPTY;

/** Only the selected authored visual and its effective presentation can alter its pixels. */
export function projectBinThumbnailInputs(projectValue: unknown, clipValue: unknown, sourceValue: unknown): readonly unknown[] {
	const project = record(projectValue), clip = record(clipValue), source = record(sourceValue);
	const values = array(project.videoVisualPresentations);
	let index = owners.get(values);
	if (!index) {
		const prepared = new Map<string, Presentation[]>();
		values.forEach((value, position) => {
			const presentation = record(value), owner = record(presentation.owner);
			if (!presentation.enabled) return;
			const key = `${String(owner.kind)}:${String(owner.id)}`, group = prepared.get(key) ?? [];
			group.push({ value: presentation, index: position }); prepared.set(key, group);
		});
		index = prepared; owners.set(values, index);
	}
	const presentations = [
		...(index.get(`clip:${String(clip.id)}`) ?? []), ...(index.get(`adjustment-layer:${String(clip.id)}`) ?? []),
		...(index.get(`source:${String(source.id)}`) ?? []), ...(index.get(`generator:${String(source.id)}`) ?? []),
	].sort((a, b) => a.index - b.index).map(entry => entry.value);
	const graphs = array(project.videoMaskMattes);
	let maskById = masks.get(graphs);
	if (!maskById) { maskById = new Map(graphs.map(value => { const graph = record(value); return [graph.id, graph]; })); masks.set(graphs, maskById); }
	const maskIds = new Set(presentations.flatMap(presentation => array(presentation.maskMatteIds)));
	return [project.id, project.schemaFamily, project.schemaVersion, clipValue, sourceValue,
		...presentations, ...[...maskIds].sort().map(id => maskById.get(id))];
}
