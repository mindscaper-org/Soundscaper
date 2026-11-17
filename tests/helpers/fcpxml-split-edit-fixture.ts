/* SPDX-License-Identifier: AGPL-3.0-only */
export type FcpxmlSplitHost = 'asset-clip' | 'clip' | 'sync-clip';
export function fcpxmlSplitEdit(host: FcpxmlSplitHost, audioStart: number, audioDuration?: number, includeVideo = false): string {
	const attributes = `offset="2s" start="2s" duration="2s" audioStart="${audioStart}s" ${audioDuration === undefined ? '' : `audioDuration="${audioDuration}s"`}`;
	const node = host === 'asset-clip' ? `<asset-clip ref="a" ${attributes}/>` : `<${host} ${attributes}>${includeVideo ? '<video ref="a" offset="0s" start="0s" duration="6s"/>' : ''}<audio ref="a" offset="0s" start="0s" duration="6s"/></${host}>`;
	return `<fcpxml version="1.10"><resources><format id="f" frameDuration="1/25s"/><asset id="a" name="Dialogue" start="0s" duration="6s" hasVideo="${includeVideo ? 1 : 0}" hasAudio="1" audioSources="1" audioChannels="1"><media-rep kind="original-media" src="dialogue.wav"/></asset></resources><project name="Split edit"><sequence format="f" duration="6s" audioRate="48k"><spine>${node}</spine></sequence></project></fcpxml>`;
}
