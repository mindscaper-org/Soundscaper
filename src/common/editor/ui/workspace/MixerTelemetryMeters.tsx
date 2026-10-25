/* SPDX-License-Identifier: AGPL-3.0-only */

import { useRef } from 'react';
import { useAudioEditorTelemetrySelector } from '../DesignSystemRuntime.jsx';
import { usePlaybackMeterVisibility } from '../usePlaybackMeterVisibility.ts';
import { meterChannelReadings, productionStripMeter, sameMeterChannelDisplay, type ScalarMeterSnapshot } from '../meter-channel-readings.ts';
import type { StripMeterSnapshot } from '../../production-audio/strip-meter-session.ts';

interface MixerMeterTelemetrySnapshot {
	readonly meters?: Readonly<{
		readonly master?: ScalarMeterSnapshot;
		readonly groups?: Readonly<Record<string, ScalarMeterSnapshot>>;
		readonly sends?: Readonly<Record<string, ScalarMeterSnapshot>>;
		readonly tracks?: Readonly<Record<string, ScalarMeterSnapshot>>;
		readonly productionMeters?: readonly StripMeterSnapshot[];
	}>;
}

interface MixerMeterTelemetryController {
	readonly engine?: object;
	readonly getTelemetrySnapshot: () => MixerMeterTelemetrySnapshot;
	readonly subscribeTelemetry: (listener: () => void) => () => void;
}

type MixerMeterScope = 'track' | 'group' | 'send' | 'master';

export function MixerTelemetryMeters({
	controller,
	scope,
	targetId,
}: Readonly<{
	controller: MixerMeterTelemetryController;
	scope: MixerMeterScope;
	targetId: string;
}>) {
	const meterRef = useRef<HTMLDivElement>(null);
	usePlaybackMeterVisibility(controller.engine, scope, targetId, meterRef);
	const meter = useAudioEditorTelemetrySelector(
		controller,
		(telemetry: MixerMeterTelemetrySnapshot) => {
			const production = productionStripMeter(telemetry.meters?.productionMeters, scope, targetId);
			if (production) return production;
			if (scope === 'track') return telemetry.meters?.tracks?.[targetId];
			if (scope === 'master') return telemetry.meters?.master;
			return telemetry.meters?.[`${scope}s`]?.[targetId];
		},
		sameMeterChannelDisplay,
	);

	return <>{meterChannelReadings(meter).map((reading, index) => <MixerMeterBar key={index} {...reading} meterRef={index === 0 ? meterRef : undefined} />)}</>;
}

function MixerMeterBar({ level, clipped, meterRef }: Readonly<{
	level: number; clipped: boolean; meterRef?: React.RefObject<HTMLDivElement | null>;
}>) {
	const clampedLevel = Math.max(0, Math.min(100, level));
	return <div ref={meterRef} className="mixer-channel__meter-bar">
		<div className={`mixer-channel__meter-clip ${clipped ? 'mixer-channel__meter-clip--active' : ''}`} />
		<div className="mixer-channel__meter-fill" style={{ top: 0, height: '100%', transformOrigin: 'bottom', transform: `scaleY(${clampedLevel / 100})` }} />
	</div>;
}
