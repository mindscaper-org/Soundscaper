/* SPDX-License-Identifier: AGPL-3.0-only */
export const AAC_PACKET_FRAMES = 1_024;
export const AAC_RATES = [96_000, 88_200, 64_000, 48_000, 44_100, 32_000, 24_000, 22_050, 16_000, 12_000, 11_025, 8_000] as const;

export function supportsFdkAacGeometry(sampleRate: number, channelCount: number): boolean {
	return AAC_RATES.some(rate => rate === sampleRate) && channelCount >= 1 && channelCount <= 6;
}
