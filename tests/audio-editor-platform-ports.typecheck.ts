/* SPDX-License-Identifier: AGPL-3.0-only */

import type { AudioDeviceHostPort, AudioInputStreamPort, AudioOutputStreamPort } from '../src/common/editor/platform/audio-device-port.ts';
import type { AudioEffectHostPort, AudioEffectInstancePort } from '../src/common/editor/platform/audio-effect-host-port.ts';
import type { CaptureSourcePortV1 } from '../src/common/editor/platform/capture-source-port.ts';
import type {
	MediaDecodePort,
	MediaDecodeSessionPort,
	MediaEncodePort,
	MediaEncodeSessionPort,
	MediaProbePort,
} from '../src/common/editor/platform/media-codec-port.ts';
import type {
	MediaByteReaderPort,
	MediaByteWriterPort,
	StreamingMediaReadPort,
	StreamingMediaWritePort,
} from '../src/common/editor/platform/media-stream-port.ts';
import type { RenderJobHostPort, RenderJobPort } from '../src/common/editor/platform/render-job-port.ts';

type MethodRequest<Method> = Method extends (request: infer Request) => unknown ? Request : never;

function requiresSignal<Request extends Readonly<{ signal: AbortSignal }>>(..._evidence: Request[]): true {
	return true;
}

const evidence = [
		requiresSignal<MethodRequest<StreamingMediaReadPort<string>['open']>>(),
		requiresSignal<MethodRequest<MediaByteReaderPort['read']>>(),
		requiresSignal<MethodRequest<MediaByteReaderPort['close']>>(),
		requiresSignal<MethodRequest<StreamingMediaWritePort<string>['open']>>(),
		requiresSignal<MethodRequest<MediaByteWriterPort['write']>>(),
		requiresSignal<MethodRequest<MediaByteWriterPort['commit']>>(),
		requiresSignal<MethodRequest<MediaByteWriterPort['abort']>>(),
		requiresSignal<MethodRequest<MediaProbePort['probe']>>(),
		requiresSignal<MethodRequest<MediaDecodePort['open']>>(),
		requiresSignal<MethodRequest<MediaDecodeSessionPort['read']>>(),
		requiresSignal<MethodRequest<MediaDecodeSessionPort['close']>>(),
		requiresSignal<MethodRequest<MediaEncodePort['open']>>(),
		requiresSignal<MethodRequest<MediaEncodeSessionPort['write']>>(),
		requiresSignal<MethodRequest<MediaEncodeSessionPort['finish']>>(),
		requiresSignal<MethodRequest<MediaEncodeSessionPort['abort']>>(),
		requiresSignal<MethodRequest<RenderJobHostPort['open']>>(),
		requiresSignal<MethodRequest<RenderJobPort['read']>>(),
		requiresSignal<MethodRequest<RenderJobPort['result']>>(),
		requiresSignal<MethodRequest<RenderJobPort['cancel']>>(),
		requiresSignal<MethodRequest<AudioDeviceHostPort['enumerate']>>(),
		requiresSignal<MethodRequest<AudioDeviceHostPort['openInput']>>(),
		requiresSignal<MethodRequest<AudioDeviceHostPort['openOutput']>>(),
		requiresSignal<MethodRequest<AudioInputStreamPort['read']>>(),
		requiresSignal<MethodRequest<AudioInputStreamPort['close']>>(),
		requiresSignal<MethodRequest<AudioOutputStreamPort['write']>>(),
		requiresSignal<MethodRequest<AudioOutputStreamPort['close']>>(),
		requiresSignal<MethodRequest<AudioEffectHostPort['enumerate']>>(),
		requiresSignal<MethodRequest<AudioEffectHostPort['open']>>(),
		requiresSignal<MethodRequest<AudioEffectInstancePort['process']>>(),
		requiresSignal<MethodRequest<AudioEffectInstancePort['readState']>>(),
		requiresSignal<MethodRequest<AudioEffectInstancePort['writeState']>>(),
		requiresSignal<MethodRequest<AudioEffectInstancePort['close']>>(),
		requiresSignal<MethodRequest<CaptureSourcePortV1['probe']>>(),
		requiresSignal<MethodRequest<CaptureSourcePortV1['enumerate']>>(),
		requiresSignal<MethodRequest<CaptureSourcePortV1['openPreview']>>(),
	];
void evidence;
