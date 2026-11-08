/* SPDX-License-Identifier: AGPL-3.0-only */

import { Suspense, type ComponentProps } from 'react';
import { lazyEditorModule } from '../../../offline/lazy-module.tsx';
import LazyInspectorFallback from './LazyInspectorFallback.tsx';

const WebDesktopFeatureDialog = lazyEditorModule(() => import('./WebDesktopFeatureDialog.tsx'));
type Props = ComponentProps<typeof WebDesktopFeatureDialog> & {
	readonly copy: Readonly<{ loading: string }>;
};

/** Keep the optional desktop download dialog and its loading state together. */
export default function WebDesktopFeatureOverlay(props: Props) {
	return <Suspense fallback={<LazyInspectorFallback copy={props.copy} />}>
		<WebDesktopFeatureDialog {...props} />
	</Suspense>;
}
