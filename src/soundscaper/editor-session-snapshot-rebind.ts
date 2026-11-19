/* SPDX-License-Identifier: AGPL-3.0-only */

import { readSessionSnapshots, sessionSnapshotSourceIdMap } from '../common/editor/session-snapshots.ts';
import { remapProjectSourceReferences } from '../common/editor/project-source-reference-remap.ts';
import { remapProjectFeatureRequirementSourceIds, type ProjectFeatureRequirementsManifest } from '../common/editor/project-feature-requirements.ts';

/** Rebind each alternative against the archive's shared source inventory, preserving scoped identities. */
export function rebindSessionSnapshotSourceIdentities(
	project: Record<string, unknown>, sourceIdMap: ReadonlyMap<string, string>,
	rebindProduct: (project: Record<string, unknown>, sourceIdMap: ReadonlyMap<string, string>) => void,
): void {
	for (const snapshot of readSessionSnapshots(project)) {
		const mapping = sessionSnapshotSourceIdMap(snapshot, sourceIdMap);
		const inventory = new Set(snapshot.sourceIds.map(id => sourceIdMap.get(id) ?? id));
		const view: Record<string, unknown> = { ...snapshot.state, id: project.id, title: project.title,
			revision: project.revision, createdAt: project.createdAt, updatedAt: project.updatedAt,
			sources: (project.sources as Record<string, unknown>[]).filter(source => inventory.has(String(source.id))) };
		remapProjectSourceReferences(view, mapping);
		rebindProduct(view, mapping);
		view.featureRequirements = remapProjectFeatureRequirementSourceIds(view.featureRequirements as ProjectFeatureRequirementsManifest, mapping, view as never);
		const mutable = snapshot as unknown as Record<string, unknown>;
		mutable.state = Object.fromEntries(Object.keys(snapshot.state).map(key => [key, view[key]]));
		mutable.sourceIds = [...inventory];
		mutable.sourceBindings = {};
	}
}
