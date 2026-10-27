/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import test from 'node:test';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { createSoundscaperProject } from '../src/soundscaper/editor-project.ts';
import { createAudioSource, createAudioClip, createAudioTrack } from '../src/common/editor/project-media-factory.ts';
import { repairSoundscaperProject } from '../src/soundscaper/editor-project-recovery-repair.ts';
import ProjectRecoveryDialog from '../src/common/editor/ui/dialogs/ProjectRecoveryDialog.tsx';
import { PROJECT_RECOVERY_COPY_BY_LOCALE } from '../src/common/i18n/editor-project-recovery-copy.ts';
import { installReactTestDom } from './helpers/react-test-dom.ts';

test('real missing-media repairs carry semantic codes and recovery presents localized reasons with optional diagnostics', async () => {
	const source = createAudioSource({ id: 'source', frameCount: 4, sampleRate: 48_000, channelCount: 1 });
	const clip = createAudioClip({ id: 'clip', sourceId: source.id, durationFrames: 4 });
	const original = createSoundscaperProject({ id: 'damaged', sources: [source], clips: [clip], tracks: [createAudioTrack({ id: 'track', clipIds: [clip.id] })] });
	const repaired = repairSoundscaperProject(original, new Set());
	assert.equal(repaired.changes.find(change => change.path === 'sources[0]')?.reasonCode, 'media-unavailable');
	const dom = installReactTestDom(); const root = createRoot(dom.container as unknown as Element);
	const scope = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }; const prior = scope.IS_REACT_ACT_ENVIRONMENT; scope.IS_REACT_ACT_ENVIRONMENT = true;
	const actions = { list: async () => [{ id: 'damaged', title: 'Authored $&', revision: 0 }],
		inspect: async () => ({ projectId: 'damaged', title: 'Authored $&', candidates: [{ key: 'current', revision: 0, kind: 'current' as const,
			status: 'repairable' as const, changes: repaired.changes, error: 'Original English backend diagnostic' }] }), recover: async () => undefined };
	try {
		await act(async () => root.render(<ProjectRecoveryDialog initialProjectId="damaged" actions={actions} run={operation => operation()} onClose={() => undefined}
			copy={{ ...PROJECT_RECOVERY_COPY_BY_LOCALE.en, close: 'Close', projectRecoveryMediaUnavailable: 'Unlesbare Medien entfernt', projectRecoveryDamageDetected: 'Schaden erkannt' }} />));
		assert.match(dom.one('li').textContent, /sources\[0\]: Unlesbare Medien entfernt/u);
		assert.equal(dom.one('[role="alert"]').textContent, 'Schaden erkannt');
		assert.match(dom.container.textContent, /Original English backend diagnostic/u, 'the diagnostic remains available in details');
	} finally { await act(async () => root.unmount()); scope.IS_REACT_ACT_ENVIRONMENT = prior; dom.restore(); }
});
