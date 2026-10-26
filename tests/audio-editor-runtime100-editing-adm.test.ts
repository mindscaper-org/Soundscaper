/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import test from 'node:test';
import { inspectAdmAxml } from '../src/common/editor/adm-axml-document.ts';
import { normalizeAdmProjectMetadata, validateAdmAuthoredRouting } from '../src/common/editor/adm-project-metadata.ts';
import { assertCombinedAdmMixRepresentable } from '../src/common/editor/controller/track-audio/internal/mix-render/mix-render-adm.ts';
import { createMixRenderSnapshotV21 } from '../src/common/editor/controller/track-audio/internal/mix-render/mix-render-snapshot-v21.ts';
import { createDefaultMixerGraphV21, normalizeMixerGraphV21 } from '../src/common/editor/mixer-graph-v21.ts';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import type { ControllerProject } from '../src/common/editor/controller/track-audio/track-domain-types.ts';

function someVisits(run: () => void): number {
	const original = Array.prototype.some; let probes = 0;
	Array.prototype.some = function (predicate, thisArg) { return Reflect.apply(original, this, [(value: unknown, index: number, values: unknown[]) => { probes++; return Reflect.apply(predicate, thisArg, [value, index, values]) as unknown; }]) as boolean; };
	try { run(); } finally { Array.prototype.some = original; }
	return probes;
}
function nodeMembership(run: () => void): number {
	const original = Set.prototype.has; let probes = 0;
	Set.prototype.has = function (value: unknown) { if (typeof value === 'string' && value.startsWith('node-')) probes++; return Reflect.apply(original, this, [value]) as boolean; };
	try { run(); } finally { Set.prototype.has = original; }
	return probes;
}
function chainProject() {
	const count = 200;
	const groups = Array.from({ length: count }, (_, index) => ({ id: `node-${index}`, name: `Node${index}`, color: '', collapsed: false, gain: 1, pan: 0, mute: false, solo: false, effectsActive: true, effects: [], channelCount: 2 }));
	const base = createDefaultMixerGraphV21([{ id: 'track' }]);
	const edges = groups.map((group, index) => ({ id: `chain-${index}`, kind: 'assignment', source: { kind: 'mixer-node', id: group.id }, destination: index === count - 1 ? { kind: 'master' } : { kind: 'mixer-node', id: groups[index + 1]!.id }, position: 'post-fader', level: 1, enabled: true, channelMap: [0, 1] })).reverse();
	const graph = normalizeMixerGraphV21({ ...base, groups, edges: [base.edges.at(-1)!, ...edges, { ...base.edges[0], destination: { kind: 'mixer-node', id: 'node-0' } }] });
	const adm = normalizeAdmProjectMetadata({ mode: 'authored', programme: { name: 'Programme', language: '' }, content: { name: 'Content', language: '' }, bed: { name: 'Bed', layout: 'mono', assignments: [{ stripKind: 'group', stripId: 'node-199', sourceChannel: 0, bedChannel: 'M', gain: 1 }] }, objects: [{ id: 'object', name: 'Object', stripKind: 'group', stripId: 'node-199', sourceChannel: 1, gain: 1, position: { azimuth: 0, elevation: 0, distance: 1 } }] });
	return createSoundscaperProject({ id: 'adm-chain', tracks: [{ id: 'track', type: 'audio', name: 'Track' }], mixer: graph, metadata: { adm }, masterChannels: 2 }) as unknown as ControllerProject;
}

test('E21 AXML parsing admits case-insensitive references in linear work', context => {
	const contents = Array.from({ length: 400 }, (_, index) => `ACO_${(0x1a00 + index).toString(16).toUpperCase()}`);
	const xml = `<audioFormatExtended><audioProgramme audioProgrammeID="APR_1001" audioProgrammeName="Programme">${contents.map(id => `<audioContentIDRef>${id}</audioContentIDRef>`).join('')}</audioProgramme>${contents.map(id => `<audioContent audioContentID="${id}" audioContentName="Content"/>`).join('')}</audioFormatExtended>`;
	let document: ReturnType<typeof inspectAdmAxml> | undefined;
	const count = someVisits(() => { document = inspectAdmAxml(xml); });
	assert.deepEqual(document?.programmes[0]?.contentRefs, contents);
	assert.equal(document?.rawXml, xml);
	context.diagnostic(`E21 reference some visits: ${count}`);
	assert.ok(count < 1000);
	assert.throws(() => inspectAdmAxml(xml.replace('</audioProgramme>', '<audioContentIDRef>ACO_1a00</audioContentIDRef></audioProgramme>')), /duplicate reference ACO_1a00/u);
});

test('E22 ADM routing diagnostics index immutable nonterminal strip identities', context => {
	const tracks = Object.freeze(Array.from({ length: 200 }, (_, index) => Object.freeze({ id: `track-${index}`, type: 'audio' })));
	const adm = normalizeAdmProjectMetadata({ mode: 'authored', programme: { name: 'Programme', language: '' }, content: { name: 'Content', language: '' }, bed: { name: 'Bed', layout: 'mono', assignments: tracks.map(track => ({ stripKind: 'track', stripId: track.id, sourceChannel: 0, bedChannel: 'M' })) } });
	let issues: ReturnType<typeof validateAdmAuthoredRouting> = [];
	const count = someVisits(() => { issues = validateAdmAuthoredRouting(adm, { masterChannels: 2, tracks, mixer: { groups: [], sends: [], edges: [] } }); });
	assert.equal(issues.filter(issue => issue.code === 'non-terminal-strip').length, 200);
	context.diagnostic(`E22 strip some visits: ${count}`);
	assert.ok(count < 1000);
});

test('E23 combined ADM mix preflight traverses downstream nodes once', context => {
	const project = chainProject();
	const count = nodeMembership(() => assert.throws(() => assertCombinedAdmMixRepresentable(project, project.tracks, { mixDown: true, mixDownChannelCount: null, renderEffects: true, replaceOriginals: true }), /cannot split an authored ADM object/u));
	context.diagnostic(`E23 node Set.has probes: ${count}`);
	assert.ok(count < 5000);
});

test('E24 combined mix snapshot resolves forward/main-output node closure once', context => {
	const project = chainProject();
	const count = nodeMembership(() => {
		const snapshot = createMixRenderSnapshotV21(project, project.tracks, { mixDown: true, renderEffects: false });
		assert.equal(snapshot.mixer.groups.length, 200);
	});
	context.diagnostic(`E24 node Set.has probes: ${count}`);
	assert.ok(count < 10000);
});

test('AXML reference indexes retain independent owners and repeated silent UID references', () => {
	const xml = '<audioFormatExtended><audioProgramme audioProgrammeID="APR_1001" audioProgrammeName="One"><audioContentIDRef>ACO_1001</audioContentIDRef></audioProgramme><audioProgramme audioProgrammeID="APR_1002" audioProgrammeName="Two"><audioContentIDRef>ACO_1001</audioContentIDRef></audioProgramme><audioContent audioContentID="ACO_1001" audioContentName="Content"/><audioObject audioObjectID="AO_1001" audioObjectName="Silence"><audioTrackUIDRef>ATU_00000000</audioTrackUIDRef><audioTrackUIDRef>ATU_00000000</audioTrackUIDRef></audioObject></audioFormatExtended>';
	const document = inspectAdmAxml(xml);
	assert.deepEqual(document?.programmes.map(programme => programme.contentRefs), [['ACO_1001'], ['ACO_1001']]);
	assert.deepEqual(document?.objects[0]?.trackUidRefs, ['ATU_00000000', 'ATU_00000000']);
});

test('combined snapshot closure retains zero-level/silent routes and excludes disconnected chains', () => {
	const project = chainProject(), graph = normalizeMixerGraphV21(project.mixer);
	for (const [variant, expected] of [['disabled', 0], ['silent', 200], ['zero-level', 200], ['master-disabled', 200]] as const) {
		const edges = graph.edges.map(edge => variant === 'master-disabled'
			? edge.destination.kind === 'output' ? { ...edge, enabled: false } : edge
			: edge.id !== 'chain-100' ? edge : variant === 'disabled' ? { ...edge, enabled: false }
				: variant === 'silent' ? { ...edge, channelMap: [-1, -1] } : { ...edge, level: 0 });
		const candidate = { ...project, mixer: normalizeMixerGraphV21({ ...graph, edges }) } as unknown as ControllerProject;
		const snapshot = createMixRenderSnapshotV21(candidate, candidate.tracks, { mixDown: true, renderEffects: false });
		assert.equal(snapshot.mixer.groups.length, expected, variant);
	}
});
