/* SPDX-License-Identifier: AGPL-3.0-only */

import { useMemo, useState } from 'react';
import type { TimeCodeFormat } from '@soundscaper/design-system/TimeCode';
import AudioEditorTimeCodeInput from '../AudioEditorTimeCodeInput.tsx';
import { isNativeSourceFrameFormat, sourceFrameTimeCodeClock } from '../source-frame-timecode-clock.ts';

interface MotionSourceFrameTimeCodeFieldProps {
	readonly label: string;
	readonly source: unknown;
	readonly value: number;
	readonly minimum: number;
	readonly maximum: number;
	readonly sampleRate: number;
	readonly disabled: boolean;
	readonly onChange: (value: number) => void;
}

/** Analysis ranges store source ordinals, independently of the sequence clock. */
export default function MotionSourceFrameTimeCodeField(props: MotionSourceFrameTimeCodeFieldProps) {
	const clock = useMemo(() => sourceFrameTimeCodeClock(props.source), [props.source]);
	const [format, setFormat] = useState<TimeCodeFormat>('hh:mm:ss+frames');
	const ordinalClock = isNativeSourceFrameFormat(format);
	return <AudioEditorTimeCodeInput label={props.label} format={format}
		unit={ordinalClock ? 'frames' : 'seconds'} rate={clock.rate} frameRate={clock.rate} sampleRate={props.sampleRate}
		value={ordinalClock ? props.value : clock.secondsAt(props.value)}
		minimum={ordinalClock ? props.minimum : clock.secondsAt(props.minimum)}
		maximum={ordinalClock ? props.maximum : clock.secondsAt(props.maximum)}
		disabled={props.disabled} onFormatChange={setFormat}
		onChange={(value) => props.onChange(ordinalClock ? value : clock.frameAt(value))} />;
}
