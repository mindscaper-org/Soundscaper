/* SPDX-License-Identifier: AGPL-3.0-only */
export function fcpxmlContainedTrim(container: 'clip' | 'sync-clip', trimHead: boolean): string {
	return fcpxmlTrimDocument(`<${container} offset="0s" start="${trimHead ? 2 : 0}s" duration="2s"><audio ref="a" offset="0s" start="0s" duration="6s"/></${container}>`);
}

export function fcpxmlTrimDocument(spine: string): string {
	return `<fcpxml version="1.10"><resources><format id="f" frameDuration="1/25s"/><asset id="a" name="Dialogue" start="0s" duration="6s" hasVideo="0" hasAudio="1" audioSources="1" audioChannels="1"><media-rep kind="original-media" src="dialogue.wav"/></asset></resources>
<project name="Trimmed sync"><sequence format="f" duration="3s" audioRate="48k"><spine>${spine}</spine></sequence></project></fcpxml>`;
}
