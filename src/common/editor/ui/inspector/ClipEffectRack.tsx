/* SPDX-License-Identifier: AGPL-3.0-only */

import { lazy, Suspense, useMemo, useState } from 'react';
import type { ComponentProps } from 'react';
import type { AudioEditorEffectsOverlay } from './AudioEditorEffectsOverlay.jsx';
import { createAudioEditorFileService } from '../../file-service.js';

const Rack = lazy(async () => ({ default: (await import('./AudioEditorEffectsOverlay.jsx')).AudioEditorEffectsOverlay }));
type OverlayProps = ComponentProps<typeof AudioEditorEffectsOverlay>;

interface Props {
	readonly controller: OverlayProps['controller'];
	readonly snapshot: OverlayProps['snapshot'];
	readonly clipId: string;
	readonly copy: Readonly<Record<string, string>>;
	readonly disabled: boolean;
}

/** Opt-in presentation state belongs to this clip, never to the saved rack. */
export default function ClipEffectRack({ controller, snapshot, clipId, copy, disabled }: Props) {
	const [open, setOpen] = useState(false);
	const fileService = useMemo(() => createAudioEditorFileService(), []);
	return <details open={open} className="audio-editor-clip-effect-rack" onToggle={event => setOpen(event.currentTarget.open)}>
		<summary>{copy.effects}</summary>
		{open && <fieldset disabled={disabled} aria-label={copy.effects}>
			<Suspense fallback={null}><Rack isOpen controller={controller} snapshot={snapshot} copy={copy}
				locale={undefined} fileService={fileService} scope="clip" trackId={clipId} layout="docked"
				autoFocusOnOpen={false} onClose={() => setOpen(false)} selectedEffect={undefined} onSelectedEffectChange={undefined} /></Suspense>
		</fieldset>}
	</details>;
}
