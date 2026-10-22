/* SPDX-License-Identifier: AGPL-3.0-only */

import { VarispeedControl } from '@soundscaper/design-system/VarispeedControl/VarispeedControl';
import { useAudioEditorTelemetrySelector } from '../DesignSystemRuntime.jsx';
import { playAtSpeedRateBounds } from '../../engine/buffer-math.ts';

interface Props {
	readonly controller: {
		readonly actions: { readonly transport: { setPlayAtSpeedRate(rate: number): unknown } };
		subscribeTelemetry(listener: () => void): () => void;
		getTelemetrySnapshot(): { readonly transportState?: string };
	};
	readonly snapshot: { readonly recording?: unknown; readonly playbackOptions?: { readonly rate?: number; readonly mode?: string; readonly preparing?: boolean } };
	readonly copy: Readonly<Record<string, string>>;
	readonly blocked: boolean;
	readonly run: (operation: () => unknown) => unknown;
}

/** Optional upstream slider uses the same transport session as the Play dropdown. */
export default function PlaybackSpeedToolbarControl({ controller, snapshot, copy, blocked, run }: Props) {
	const transportState = useAudioEditorTelemetrySelector(controller, (telemetry: { readonly transportState?: string }) => telemetry.transportState);
	const rate = snapshot.playbackOptions?.rate ?? 1;
	const { minimum, maximum } = playAtSpeedRateBounds(snapshot.playbackOptions?.mode === 'staffpad');
	const update = (next: number) => { run(() => controller.actions.transport.setPlayAtSpeedRate(next)); };
	return <VarispeedControl speed={rate} enabled={rate !== 1} minimumSpeed={minimum} maximumSpeed={maximum}
		label={copy.speed ?? copy.playbackSpeed} title={copy.playbackSpeed}
		disabled={blocked || Boolean(snapshot.recording) || Boolean(snapshot.playbackOptions?.preparing) || transportState === 'playing'}
		onChange={update} onDial={update} />;
}
