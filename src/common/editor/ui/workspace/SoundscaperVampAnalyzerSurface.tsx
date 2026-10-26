/* SPDX-License-Identifier: AGPL-3.0-only */
import { VAMP_COPY, VAMP_COPY_ALIASES } from '../../../i18n/editor-vamp-copy.ts';
import { resolveEditorCopyScope } from '../../../i18n/editor-copy-scope.ts';

/** Menu-owned asynchronous catalog shell for the lazy Vamp dialog. */

import React, { useEffect, useMemo, useState } from 'react';

import {
	createSoundscaperVampAnalyzerSession,
	type SoundscaperVampAnalyzerSession,
} from './soundscaper-vamp-analyzer-runtime.ts';
import {
	createDesktopVampAnalysisAction,
} from '../../controller/analysis/vamp-analysis-action-facade.ts';
import type { SoundscaperVampAnalyzerSurfaceInput } from './SoundscaperNativeServicesSurface.tsx';
import { editorProjectEditSessionKey } from '../project-edit-session-key.ts';
import type { VampAnalysisResult } from '../../vamp-analysis.ts';

const VampAnalyzerDialog = React.lazy(() => import('../dialogs/VampAnalyzerDialog.tsx'));

export interface SoundscaperVampAnalyzerSurfaceProps {
	readonly input: Readonly<SoundscaperVampAnalyzerSurfaceInput>;
	readonly onClose: () => void;
	readonly copy?: Readonly<Record<string, string | undefined>>;
}

export default function SoundscaperVampAnalyzerSurface({
	input,
	onClose, copy: hostCopy,
}: Readonly<SoundscaperVampAnalyzerSurfaceProps>) {
	const copy = useMemo(() => resolveEditorCopyScope('vamp', VAMP_COPY, Object.fromEntries(Object.keys(VAMP_COPY).map(key => [key, hostCopy?.[`ui.vamp.${key}`] ?? hostCopy?.[VAMP_COPY_ALIASES[key] ?? '']]))), [hostCopy]);
	const port = useMemo(() => createDesktopVampAnalysisAction({
		bridge: input.bridge,
		engine: input.engine,
		getProject: () => input.controller.project,
	}), [input.bridge, input.controller, input.engine]);
	const currentSession = useMemo(() => createSoundscaperVampAnalyzerSession({
		controller: input.controller,
		durationFrames: input.durationFrames,
		selectedTrackId: input.selectedTrackId,
		selectedClipId: input.selectedClipId,
		port,
	}), [input, port]);
	const owner = editorProjectEditSessionKey(input.controller, currentSession?.projectId);
	const [publication, setPublication] = useState<Readonly<{
		owner: string; session: SoundscaperVampAnalyzerSession;
	}> | null>(null);
	// Our own label commit advances the document revision. Keep its dialog alive
	// until the success callback closes it; a different activation retires it.
	const session = publication?.owner === owner ? publication.session : currentSession;
	const publishLabels = async (result: VampAnalysisResult, name: string): Promise<void> => {
		if (session === null) return;
		const pending = { owner, session };
		setPublication(pending);
		try { await session.publishLabels(result, name); }
		catch (error) {
			setPublication(current => current === pending ? null : current);
			throw error;
		}
	};
	const [catalog, setCatalog] = useState<unknown>(Object.freeze([]));
	const [catalogMessage, setCatalogMessage] = useState<'loading' | 'empty' | 'error'>('loading');
	useEffect(() => {
		if (session === null) return undefined;
		let active = true;
		void session.loadCatalog().then((value) => {
			if (!active) return;
			setCatalog(value);
			setCatalogMessage('empty');
		}).catch(() => {
			if (!active) return;
			setCatalog(Object.freeze([]));
			setCatalogMessage('error');
		});
		return () => { active = false; };
	}, [session]);
	if (session === null) return null;
	return <React.Suspense fallback={null}>
		<VampAnalyzerDialog
			key={`${owner}:${String(session.projectRevision)}`}
			catalog={catalog}
			projectId={session.projectId}
			scope={session.scope}
			startFrame={session.startFrame}
			endFrame={session.endFrame}
			sampleRate={session.sampleRate}
			analyze={session.analyze}
			publishLabels={publishLabels}
			onClose={onClose}
			copy={{ ...copy, noAnalyzers: catalogMessage === 'loading' ? copy.loadingCatalog : catalogMessage === 'error' ? copy.catalogFailed : copy.noAnalyzers }}
		/>
	</React.Suspense>;
}
