/* SPDX-License-Identifier: AGPL-3.0-only */

import type { ComponentProps } from 'react';
import { lazyEditorModule } from '../../../offline/lazy-module.tsx';
import type MicrophoneBleedDialogComponent from '../dialogs/MicrophoneBleedDialog.tsx';

const Dialog = lazyEditorModule(() => import('../dialogs/MicrophoneBleedDialog.tsx'));
export default function MicrophoneBleedSurface(props: ComponentProps<typeof MicrophoneBleedDialogComponent> & { readonly activeSurface: string | null }) {
	return props.activeSurface === 'microphone-bleed' ? <Dialog {...props} /> : null;
}
