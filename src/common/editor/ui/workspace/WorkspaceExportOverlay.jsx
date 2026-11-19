/* SPDX-License-Identifier: AGPL-3.0-only */

import React from 'react';
import { lazyEditorModule } from '../../../offline/lazy-module.tsx';
import LazyInspectorFallback from './LazyInspectorFallback.tsx';

const ExportDialog = lazyEditorModule(() => import('../inspector/ExportDialog.jsx'));

export default function WorkspaceExportOverlay({ model }) {
	const { activeSurface, surfaceRequestId, clipExportRequest, controller, snapshot, copy, productId, fileService, locale, setActiveSurface } = model;
	const selection = activeSurface === 'export-selection';
	if (!selection && activeSurface !== 'export') return null;
	return <div data-editor-surface="export">
		<React.Suspense fallback={<LazyInspectorFallback copy={copy} />}>
			<ExportDialog
				key={selection ? surfaceRequestId : undefined}
				isOpen
				clipExportRequest={selection ? clipExportRequest : null}
				controller={controller}
				snapshot={snapshot}
				copy={copy}
				productId={productId}
				fileService={fileService}
				locale={locale}
				onClose={() => setActiveSurface(null)}
			/>
		</React.Suspense>
	</div>;
}
