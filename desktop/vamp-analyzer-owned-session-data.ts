/* SPDX-License-Identifier: AGPL-3.0-only */

import { admitVampAnalyzerFeatures, admitVampAnalyzerPcmChunk,
	type VampAnalyzerConfiguration, type VampAnalyzerFeature,
	type VampAnalyzerOutputDescriptor, type VampAnalyzerPcmChunk } from './vamp-analyzer-contract.ts';

const ownedPcm = new WeakMap<object, Readonly<{ channelCount: number; totalFrames: number }>>();
const ownedFeatures = new WeakMap<object, string>();

/** Only the session's external PCM boundary creates transferable private planes. */
export function captureVampAnalyzerSessionPcm(
	value: unknown, configuration: Readonly<VampAnalyzerConfiguration>, expectedStartFrame: number,
): Readonly<VampAnalyzerPcmChunk> {
	const chunk = admitVampAnalyzerPcmChunk(value, configuration, expectedStartFrame);
	ownedPcm.set(chunk, { channelCount: configuration.channelCount, totalFrames: configuration.frameCount });
	return chunk;
}

export function consumeVampAnalyzerSessionPcm(
	chunk: Readonly<VampAnalyzerPcmChunk>, configuration: Readonly<VampAnalyzerConfiguration>,
	expectedStartFrame: number,
): Readonly<VampAnalyzerPcmChunk> {
	const ownership = ownedPcm.get(chunk);
	if (ownership && ownership.channelCount === configuration.channelCount
		&& ownership.totalFrames === configuration.frameCount && chunk.startFrame === expectedStartFrame) {
		ownedPcm.delete(chunk);
		return chunk;
	}
	const admitted = admitVampAnalyzerPcmChunk({ startFrame: chunk.startFrame, channels: chunk.channels },
		configuration, expectedStartFrame);
	if (chunk.frameCount !== admitted.frameCount) throw new RangeError('The Vamp PCM frame count is inconsistent.');
	return admitted;
}

/** Native answers are normalized once; all nested feature values are immutable. */
export function captureVampAnalyzerBackendFeatures(
	value: unknown, outputs: readonly Readonly<VampAnalyzerOutputDescriptor>[],
): readonly Readonly<VampAnalyzerFeature>[] {
	const features = admitVampAnalyzerFeatures(value, outputs);
	ownedFeatures.set(features, outputSignature(outputs));
	return features;
}

export function reviewVampAnalyzerBackendFeatures(
	value: unknown, outputs: readonly Readonly<VampAnalyzerOutputDescriptor>[],
): readonly Readonly<VampAnalyzerFeature>[] {
	if (Array.isArray(value) && ownedFeatures.get(value) === outputSignature(outputs)) {
		return value as readonly Readonly<VampAnalyzerFeature>[];
	}
	return admitVampAnalyzerFeatures(value, outputs);
}

function outputSignature(outputs: readonly Readonly<VampAnalyzerOutputDescriptor>[]): string {
	return JSON.stringify(outputs);
}
