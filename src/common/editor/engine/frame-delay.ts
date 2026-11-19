/* SPDX-License-Identifier: AGPL-3.0-only */
import { addNode, connect, setParam, type AudioNodeCollection } from './audio-node-utils.ts';

/** Integer source-clock alignment, owned and disposed with the surrounding graph. */
export function delayAudioNodeFrames(context: BaseAudioContext, input: AudioNode, frames: number, nodes: AudioNodeCollection): AudioNode {
	if (!Number.isSafeInteger(frames) || frames < 0) throw new RangeError('Invalid audio compensation delay.');
	if (!frames) return input;
	const seconds = frames / context.sampleRate;
	const delay = addNode(nodes, context.createDelay(Math.max(1, seconds)));
	setParam(delay.delayTime, seconds, context.currentTime); connect(input, delay);
	return delay;
}
