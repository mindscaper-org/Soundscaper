/* SPDX-License-Identifier: AGPL-3.0-only */

import type { ComponentProps } from 'react';
import { lazyEditorModule } from '../../../offline/lazy-module.tsx';
import MicrophoneBleedSurface from './MicrophoneBleedSurface.tsx';

const AnalysisDialog = lazyEditorModule(() => import('../dialogs/AnalysisDialog.jsx'));
type Props = ComponentProps<typeof MicrophoneBleedSurface> & {
	readonly surfaceRequestId?: string | number;
	readonly fileService: unknown;
};

/** Group opt-in audio analysis dialogs without growing the workspace's general overlay owner. */
export default function WorkspaceAudioAnalysisOverlays({ activeSurface, surfaceRequestId, controller, snapshot, copy, fileService, onClose }: Props) {
	return <>
		{activeSurface?.startsWith('offline-analysis-') && <div data-editor-surface={activeSurface}>
			<AnalysisDialog mode={activeSurface.slice('offline-analysis-'.length)} requestId={surfaceRequestId}
				controller={controller} snapshot={snapshot} copy={copy} fileService={fileService} onClose={onClose} />
		</div>}
		<MicrophoneBleedSurface activeSurface={activeSurface} controller={controller} snapshot={snapshot} copy={copy} onClose={onClose} />
	</>;
}
