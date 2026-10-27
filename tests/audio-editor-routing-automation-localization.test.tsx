/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createAudioSource, createAudioClip, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { SOUNDSCAPER_ROUTING_GRAPH_COPY as ROUTING } from '../src/common/editor/ui/workspace/soundscaper-routing-graph-copy.ts';
import { routingSourceOptions, routingDestinationOptions } from '../src/common/editor/ui/workspace/soundscaper-routing-graph-candidates.ts';
import Inspector from '../src/common/editor/ui/workspace/SoundscaperRoutingGraphInspector.tsx';
import { createTrackAutomationTargetInventoryV21 } from '../src/common/editor/track-automation-targets-v21.ts';
import { TrackAutomationSelectors } from '../src/common/editor/ui/timeline/TrackAutomationSelectors.tsx';
import { ENGLISH_COPY } from '../src/common/i18n/catalogs.js';
import { TRACK_AUTOMATION_COPY_BY_LOCALE } from '../src/common/i18n/editor-track-automation-copy.ts';
Object.assign(globalThis, { React });
const noop = () => undefined;
const project = createSoundscaperProject({ id: 'routing-locale', tracks: [createAudioTrack({ id: 'voice', name: '$& Voice' })] });

test('routing endpoint kinds and connection summaries localize around authored names', () => {
	const copy = { ...ROUTING, track: 'Piste', output: 'Sortie', master: 'Maître', assignment: 'Affectation', postFader: 'Post-fader localisé' };
	const sources = routingSourceOptions(project, project.mixer, copy);
	const destinations = routingDestinationOptions(project, project.mixer, copy);
	assert.ok(sources.some(option => option.label === 'Piste: $& Voice'));
	assert.ok(destinations.some(option => option.label.startsWith('Sortie: ')));
	const edge = project.mixer.edges.find(entry => entry.source.kind === 'track'); assert.ok(edge);
	const html = renderToStaticMarkup(<Inspector project={project} graph={project.mixer} copy={copy} selection={{ kind: 'edge', id: edge.id }} disabled={false} confirmingDelete={false} onConfirmingDelete={noop} onCandidate={noop} onError={noop} />);
	assert.ok(html.includes('Piste: $&amp; Voice')); assert.ok(html.includes('Affectation · Post-fader localisé'));
});

test('actual automation inventory shows translated strip and routing targets with stable values', () => {
	const targets = createTrackAutomationTargetInventoryV21(project, 'voice'); assert.ok(targets[0]);
	const copy = { ...ENGLISH_COPY, ...TRACK_AUTOMATION_COPY_BY_LOCALE.en,
		'ui.designSystem.volume': 'Volume localisé', pan: 'Panoramique', mute: 'Muet', track: 'Piste', master: 'Maître',
		automationGroupRouting: 'Routage', automationAssignmentTarget: 'Affectation vers {destination}',
	};
	const html = renderToStaticMarkup(<TrackAutomationSelectors trackId="voice" targets={targets} selectedTarget={targets[0]} copy={copy} onTarget={noop} />);
	for (const text of ['Volume localisé', 'Panoramique', 'Muet', 'Piste', 'Routage', 'Affectation vers Maître']) assert.ok(html.includes(text), text);
	assert.ok(html.includes(targets[0].key.replaceAll('"', '&quot;')));
});

test('multichannel pan restrictions localize without changing automation admission', () => {
	const source = createAudioSource({ id: 'six', channelCount: 6, frameCount: 48000 });
	const clip = createAudioClip({ id: 'clip', sourceId: source.id, durationFrames: 48000, sourceDurationFrames: 48000 });
	const multichannel = createSoundscaperProject({ id: 'six-channel', masterChannels: 6, sources: [source], clips: [clip], tracks: [createAudioTrack({ id: 'voice', clipIds: ['clip'] })] });
	const targets = createTrackAutomationTargetInventoryV21(multichannel, 'voice'); assert.ok(targets[0]);
	const html = renderToStaticMarkup(<TrackAutomationSelectors trackId="voice" targets={targets} selectedTarget={targets[0]} copy={{ ...ENGLISH_COPY, ...TRACK_AUTOMATION_COPY_BY_LOCALE.en, automationMultichannelPanUnavailable: 'Le panoramique multicanal est indisponible.' }} onTarget={noop} />);
	assert.ok(html.includes('Le panoramique multicanal est indisponible.'));
	assert.match(html, /<option[^>]*disabled=""[^>]*>Pan — Le panoramique multicanal est indisponible\./u);
});

test('registered effect parameter names localize through their existing canonical copy', async () => {
	const { createEffect } = await import('../src/common/editor/effects.js');
	const { effectNameCopyKey } = await import('../src/common/i18n/canonical-extras.js');
	const effect = createEffect('highpass', { id: 'filter' });
	const filtered = createSoundscaperProject({ id: 'filter-project', tracks: [createAudioTrack({ id: 'voice', effects: [effect] })] });
	const targets = createTrackAutomationTargetInventoryV21(filtered, 'voice'); assert.ok(targets[0]);
	const html = renderToStaticMarkup(<TrackAutomationSelectors trackId="voice" targets={targets} selectedTarget={targets[0]} copy={{ ...ENGLISH_COPY, ...TRACK_AUTOMATION_COPY_BY_LOCALE.en, effectParamFrequency: 'Fréquence', [effectNameCopyKey('highpass')]: 'Filtre passe-haut' }} onTarget={noop} />);
	assert.ok(html.includes('Fréquence')); assert.ok(html.includes('Filtre passe-haut'));
});
