/* SPDX-License-Identifier: AGPL-3.0-only */

import { canonicalStripRefKey } from '../parameter-address.ts';
import { hasProductionMixerProjectAuthority } from '../project-schema-version.ts';
import { reconcileEngineChannelMeters } from './engine-channel-meter-aggregate.ts';
import { readEngineMeter, readMasterMeter, type MutableEngineMeterReading } from './engine-meter-reading.ts';
import { ensureLiveAnalysisTap } from './live-analysis-tap.ts';
import { readPlaybackMeterDemand } from './playback-meter-demand.ts';
import { sampleProductionMeterSessionV21 } from './production-meter-runtime-session-v21.ts';
import type { EngineRuntimeHost } from './runtime-types.ts';
import type { EngineMeterSnapshot } from './public-api.ts';

/** Production channel readings are authoritative; scalar analysers fill gaps only. */
export function samplePlaybackMeters(owner: EngineRuntimeHost): EngineMeterSnapshot | null {
	const { graph } = owner;
	if (!graph) return null;
	const demand = readPlaybackMeterDemand(owner, owner.project);
	const production = hasProductionMixerProjectAuthority(owner.project)
		? sampleProductionMeterSessionV21(owner, owner.project, graph.productionStripAnalysersV21,
			owner.latestMasterLoudnessMeter, demand) : null;
	const measured = new Set(production?.productionMeters.map(({ strip }) => canonicalStripRefKey(strip)));
	const tracks = scalarReadings(graph.trackAnalysers, 'track', demand, measured);
	const groups = scalarReadings(graph.groupAnalysers, 'mixer-node', demand, measured);
	const sends = scalarReadings(graph.sendAnalysers, 'mixer-node', demand, measured);
	const liveTap = owner.liveAnalysisLeaseCount > 0 ? ensureLiveAnalysisTap(owner.context, graph) : null;
	const master = readMasterMeter(measured.has(canonicalStripRefKey({ kind: 'master' })) ? null : graph.masterAnalyser, liveTap);
	if (owner.latestMasterLoudnessMeter?.loudness) master.loudness = owner.latestMasterLoudnessMeter.loudness;
	return reconcileEngineChannelMeters({ master, tracks, groups, sends, ...(production ?? {}) });
}

function scalarReadings(
	analysers: ReadonlyMap<string, AnalyserNode> | undefined,
	kind: 'track' | 'mixer-node', demand: ReadonlySet<string> | null, measured: ReadonlySet<string>,
): Record<string, MutableEngineMeterReading> {
	const readings: Record<string, MutableEngineMeterReading> = {};
	for (const [id, analyser] of analysers ?? []) {
		const key = canonicalStripRefKey({ kind, id });
		if (demand && !demand.has(key)) continue;
		readings[id] = readEngineMeter(measured.has(key) ? null : analyser);
	}
	return readings;
}
