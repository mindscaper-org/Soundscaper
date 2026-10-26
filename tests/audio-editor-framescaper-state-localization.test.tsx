/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createRoot } from 'react-dom/client';
import FramescaperVisualInspectorDialog from '../src/common/editor/ui/dialogs/FramescaperVisualInspectorDialog.tsx';
import FramescaperOpenFxManagePanel from '../src/common/editor/ui/dialogs/FramescaperOpenFxManagePanel.tsx';
import FramescaperNativeServicesDialog from '../src/common/editor/ui/dialogs/FramescaperNativeServicesDialog.tsx';
import { MotionAnalysisControls } from '../src/common/editor/ui/dialogs/FramescaperFinishingPanels.tsx';
import { resolveFramescaperNativeServicesCopy } from '../src/common/editor/ui/framescaper-native-services-copy.ts';
import { normalizeVideoGeneratorClipV1, normalizeVideoGeneratorSourceV1 } from '../src/common/editor/video-visual-model-v24.ts';
import { framescaperNativeRendererSnapshot, framescaperNativeQueueRow,
	createFramescaperNativeServicesBridgeFixture } from './helpers/framescaper-native-services-surface-fixture.ts';
import { installReactTestDom, reactProps } from './helpers/react-test-dom.ts';

const noop = () => undefined;

test('selected visual kind and blend labels translate while stored option values remain stable', () => {
	const source = normalizeVideoGeneratorSourceV1({ schemaVersion: 1, kind: 'generator', id: 'source', name: 'Authored $&',
		width: 1920, height: 1080, frameRate: { num: 30, den: 1 }, frameCount: 150, generator: { kind: 'solid', color: '#ffffffff' } });
	const clip = normalizeVideoGeneratorClipV1({ schemaVersion: 1, kind: 'generator', id: 'clip', sourceId: source.id,
		sequenceId: 'sequence', sequenceStartFrame: 0, sequenceFrameCount: 150, sourceInFrame: 0, sourceFrameCount: 150 });
	const project = { schemaFamily: 'framescaper', schemaVersion: 1, selection: { clipIds: ['clip'] }, sources: [source], clips: [clip],
		tracks: [{ id: 'picture', type: 'video', clipIds: ['clip'] }], projectBin: { clips: [] }, videoVisualPresentations: [], videoMaskMattes: [], videoVisualPresets: [] };
	const markup = renderToStaticMarkup(<FramescaperVisualInspectorDialog project={project} selectedClipId="clip"
		editingBlocked={false} readOnly={false} controller={{ actions: { edit: { commit: noop } } }} run={operation => operation()}
		onClose={noop} copy={{ 'ui.framescaperVisualInspector.visualKindSolid': 'Farbfläche',
			'ui.framescaperVisualInspector.blendNormal': 'Normal übersetzt', 'ui.framescaperVisualInspector.blendMultiply': 'Multiplizieren',
			'ui.framescaperVisualInspector.blendScreen': 'Negativ multiplizieren', 'ui.framescaperVisualInspector.blendOverlay': 'Ineinanderkopieren',
			'ui.framescaperVisualInspector.blendAdd': 'Addieren' }} />);
	assert.match(markup, /data-visual-inspector-kind="true">Farbfläche/u);
	for (const [value, label] of [['normal', 'Normal übersetzt'], ['multiply', 'Multiplizieren'], ['screen', 'Negativ multiplizieren'], ['overlay', 'Ineinanderkopieren'], ['add', 'Addieren']]) {
		assert.match(markup, new RegExp(`value="${value}"[^>]*>${label}<`, 'u'));
	}
});

test('motion analysis progress translates its live phase and reorders literal counts', () => {
	const target = { stackId: 'stack', sourceId: 'source', sourceName: 'Authored $&', startFrame: 0, endFrame: 10, analysisId: 'analysis', freshness: 'missing' as const };
	const markup = renderToStaticMarkup(<MotionAnalysisControls blocked={false} targets={[target]} target={target} stackId="stack"
		startFrame={0} endFrame={10} source={{ id: 'source', kind: 'video', sourceFrameCount: 10, frameRate: { num: 30, den: 1 }, timingDecision: { mode: 'conform-cfr-at-ingest', rate: { num: 30, den: 1 } } }}
		progress={{ phase: 'decoding', completed: 0, total: 10 }} pending={true} copy={{ motionPhaseDecoding: 'Dekodieren', motionProgress: '{completed} von {total}: {phase}' }}
		onStack={noop} onStartFrame={noop} onEndFrame={noop} onAnalyze={noop} onCancel={noop} />);
	assert.match(markup, /0 von 10: Dekodieren/u);
});

test('native queue displays localized state while retaining the state-owned actions', () => {
	const base = framescaperNativeRendererSnapshot({ runtimeAvailable: true, nativeMediaEnabled: true });
	const markup = renderToStaticMarkup(<FramescaperNativeServicesDialog bridge={createFramescaperNativeServicesBridgeFixture().bridge}
		initialSurface="background-jobs" initialSnapshot={{ ...base, services: { ...base.services, queue: [framescaperNativeQueueRow('needs-authorization')] } }}
		copy={{ 'ui.framescaperNative.queueStateNeedsAuthorization': 'Autorisierung erforderlich' }} onClose={noop} />);
	assert.match(markup, /Autorisierung erforderlich/u);
	assert.doesNotMatch(markup, /State: needs-authorization/u);
	assert.match(markup, /Reauthorize destination folder/u);
});

test('OpenFX registry state labels translate in both table and filter, preserving plugin identities', async () => {
	const dom = installReactTestDom(); const root = createRoot(dom.container as unknown as Element);
	const priorReact = Object.getOwnPropertyDescriptor(globalThis, 'React');
	const scope = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }; const priorAct = scope.IS_REACT_ACT_ENVIRONMENT;
	Object.defineProperty(globalThis, 'React', { configurable: true, value: React }); scope.IS_REACT_ACT_ENVIRONMENT = true;
	const bridge = createFramescaperNativeServicesBridgeFixture({ listOpenFxPlugins: async () => [{ pluginHandle: 'ab'.repeat(20),
		pluginId: 'Authored.Plugin', vendor: 'Authored Vendor', version: { major: 1, minor: 0 }, binarySha256: 'cd'.repeat(32), supportedContexts: ['filter'],
		parameters: [], components: ['RGBA'], pixelDepths: ['float'], threading: 'instance-safe', state: 'discovered', quarantined: false }] }).bridge;
	try {
		await act(async () => root.render(<FramescaperOpenFxManagePanel bridge={bridge} busy={false} setConsent={noop}
			snapshot={framescaperNativeRendererSnapshot({ runtimeAvailable: true, nativeMediaEnabled: true })}
			copy={resolveFramescaperNativeServicesCopy({ ofxStateDiscovered: 'Gefunden' })} />));
		await act(async () => reactProps(dom.one('.dropdown__trigger')).onClick());
		assert.equal((document.body.textContent?.match(/Gefunden/gu) ?? []).length, 2, 'both table and filter option translate');
		assert.match(dom.container.textContent, /Authored.PluginAuthored VendorGefunden/u);
	} finally {
		await act(async () => root.unmount()); scope.IS_REACT_ACT_ENVIRONMENT = priorAct;
		if (priorReact) Object.defineProperty(globalThis, 'React', priorReact); else Reflect.deleteProperty(globalThis, 'React'); dom.restore();
	}
});
