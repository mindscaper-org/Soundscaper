/* SPDX-License-Identifier: AGPL-3.0-only */

import { useMemo, useState } from 'react';
import type { TimeCodeFormat } from '@soundscaper/design-system/TimeCode';
import AudioEditorTimeCodeInput from '../AudioEditorTimeCodeInput.tsx';
import EditorControlLabel from '../EditorControlLabel.tsx';
import { isNativeSourceFrameFormat, sourceFrameTimeCodeClock } from '../source-frame-timecode-clock.ts';

interface ClipSourceInTimeCodeFieldProps {
	readonly label: string;
	readonly value: number;
	readonly source: unknown;
	readonly sampleRate: number;
	readonly frameRate?: number;
	readonly disabled: boolean;
	readonly onCommit: (value: number) => unknown;
}

/** Native video source positions are ordinals; audio positions are samples. */
export default function ClipSourceInTimeCodeField({
	label, value, source, sampleRate, frameRate, disabled, onCommit,
}: ClipSourceInTimeCodeFieldProps) {
	const video = isNativeVideoSource(source) ? source : null;
	const clock = useMemo(() => video ? sourceFrameTimeCodeClock(video) : null, [video]);
	const [format, setFormat] = useState<TimeCodeFormat>('hh:mm:ss+milliseconds');
	const nativeFrames = clock !== null && isNativeSourceFrameFormat(format);
	const lastFrame = video ? Number(video.sourceFrameCount) - 1 : undefined;
	return <label className="audio-editor-field" data-clip-field="sourceInFrame"><EditorControlLabel>{label}</EditorControlLabel>
		<AudioEditorTimeCodeInput label={label} value={clock && !nativeFrames ? clock.secondsAt(value) : value}
			unit={nativeFrames ? 'frames' : clock ? 'seconds' : 'samples'}
			rate={nativeFrames ? clock.rate : sampleRate} sampleRate={sampleRate}
			frameRate={clock?.rate ?? frameRate} format={format} onFormatChange={setFormat}
			maximum={nativeFrames ? lastFrame : undefined}
			disabled={disabled} onCommit={(position) => onCommit(clock && !nativeFrames && lastFrame !== undefined
				? Math.min(lastFrame, clock.frameAt(position))
				: position)} />
	</label>;
}

function isNativeVideoSource(value: unknown): value is Readonly<Record<string, unknown>> {
	return value !== null && typeof value === 'object' && !Array.isArray(value)
		&& (value as Readonly<Record<string, unknown>>).kind === 'video'
		&& Number.isSafeInteger((value as Readonly<Record<string, unknown>>).sourceFrameCount)
		&& Number((value as Readonly<Record<string, unknown>>).sourceFrameCount) > 0;
}
