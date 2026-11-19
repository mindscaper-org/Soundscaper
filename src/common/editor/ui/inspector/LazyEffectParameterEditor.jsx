/* SPDX-License-Identifier: AGPL-3.0-only */

import { Suspense } from 'react';
import { lazyEditorModule } from '../../../offline/lazy-module.tsx';

const NativePluginParameterControls = lazyEditorModule(() => import('../dialogs/NativePluginParameterControls.tsx'));
const EffectParameterEditor = lazyEditorModule(() => import('./EffectParameterEditor.jsx'));

export default function LazyEffectParameterEditor(props) {
	return <Suspense fallback={null}>{props.effect?.type === 'native-plugin'
		? <NativePluginParameterControls instanceId={props.effect.params.instanceId} disabled={props.disabled} />
		: <EffectParameterEditor {...props} />}</Suspense>;
}
