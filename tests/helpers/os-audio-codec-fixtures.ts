/* SPDX-License-Identifier: AGPL-3.0-only */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

/* Valid but deliberately unqualified AAC-LC M4A media: 44.1 kHz stereo, generated
 * from a 997 Hz 50 ms source with the digest-pinned mwader/static-ffmpeg 9.0 image
 * sha256:b90574a4e2ae62b763c39c384526689e7eb435da6398f4fb3f6c3f1c6a14ce33. */
const AAC_LC_M4A_44_100_BASE64 =
	'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';

export function aacLcM4a44_100Fixture(): Uint8Array {
	const bytes = new Uint8Array(Buffer.from(AAC_LC_M4A_44_100_BASE64, 'base64'));
	assert.equal(bytes.byteLength, 1_991);
	assert.equal(
		createHash('sha256').update(bytes).digest('hex'),
		'421d7b9a1beeb1fefb3463c32f13aa91f81dde4730087df490afea1e5a8b3106',
	);
	return bytes;
}

export function aacLcM4a48_000Fixture(): Uint8Array {
	const source = readFileSync(new URL(
		'../../native/soundscaper-professional-host/tests/os_audio_codec_self_test.cpp',
		import.meta.url,
	), 'utf8');
	const block = /constexpr char aacM4aCanaryBase64\[\] =([\s\S]*?);/u.exec(source)?.[1];
	assert.ok(block !== undefined);
	const encoded = [...block.matchAll(/"([^"]*)"/gu)].map((match) => match[1]).join('');
	const bytes = new Uint8Array(Buffer.from(encoded, 'base64'));
	assert.equal(bytes.byteLength, 1_909);
	assert.equal(
		createHash('sha256').update(bytes).digest('hex'),
		'1db255988826f9f6f8322f6cfb6c82c6ee7873c3252c822bc0ac1793d5729451',
	);
	return bytes;
}

export function mp3Mpeg1Fixture(
	sampleRateIndex: 0 | 1,
	bitrateIndex = 9,
	channelMode = 0,
	secondSampleRateIndex: 0 | 1 = sampleRateIndex,
): Uint8Array {
	const bitrates = [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0];
	const bitrateKbps = bitrates[bitrateIndex];
	assert.ok(bitrateKbps !== undefined && bitrateKbps > 0);
	const sampleRate = sampleRateIndex === 0 ? 44_100 : 48_000;
	const secondSampleRate = secondSampleRateIndex === 0 ? 44_100 : 48_000;
	const frameBytes = Math.floor(144_000 * bitrateKbps / sampleRate);
	const secondFrameBytes = Math.floor(144_000 * bitrateKbps / secondSampleRate);
	const bytes = new Uint8Array(frameBytes + secondFrameBytes);
	const header = 0xffe0_0000 | 3 << 19 | 1 << 17 | 1 << 16
		| bitrateIndex << 12 | sampleRateIndex << 10 | channelMode << 6;
	const secondHeader = 0xffe0_0000 | 3 << 19 | 1 << 17 | 1 << 16
		| bitrateIndex << 12 | secondSampleRateIndex << 10 | channelMode << 6;
	const view = new DataView(bytes.buffer);
	view.setUint32(0, header, false);
	view.setUint32(frameBytes, secondHeader, false);
	return bytes;
}

// AAC-LC ADTS from the installed @ffmpeg/core0.12.10 encoder (FFmpeg5.1.4):
// stereo48kHz1000Hz/0.1s PCM, -c:a aac -aac_pce0|1 -f adts. No compressed packet edits.
const AAC_ADTS_PCE_0 =
	'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';
const AAC_ADTS_PCE_1 =
	'//FMACef/KCYgAAEAA1MYXZjNTkuMzcuMTAw3gIATGF2YzU5LjM3LjEwMABCVR/////gAm7bSkfoiDoW/Pz9/ETx39/LVS8q5Nxc'
	+ 'm4hEdpBBoK1NNtWymS7G0a7nTGUw09iuxu3Zi1beWTA/jYz3Da341HdQ6+1ri2069nNy47w207dYcVWZ64z1ZjsTjrDWp2tNWyls'
	+ 'pVKTSk0ZKUqlKpSqUqlKpSaUmlKpSqMqjJr5NobQwMDfJtLAwMDAwMDAwMDaG0MDAwMDaWBgYGBgYG0tpYGBgZFLLLLLLLLLLLLL'
	+ 'LLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLLFFFFFFFFNj8Hn0Xh0Lfn5+/iJ47+/lqpeVcm4uTc'
	+ 'AO0gAAAAAAAAAAAAAAAA4P/xTAAuH/whTGz+B/1/x/xI2Wu61ETXISa61RP/T/rriPLV6u/P7X+tia1e/+3+ga1dXf/0/0HGruoI'
	+ 'y7R7x8HZ2dnYdo4GufQWhVycEieeRmGocxIeI2YTg3ZlBoL9NDGZ/13+XYfa3OhrrPBusWKUSVhghVVTWmTct698ZCZZb14JCZZX'
	+ 'vO4SEhMsr3ncJCQmWVV7NwkJCZZXe87uEhISE2LDJ5iaRDTIL5YSm1yOK4sRmGocxIeI2YTg3ZlBKkKhwZXN0wSWT7L+Ntt9wjR1'
	+ 'M6Gus8G6xYpRJWGCFVVNaZNy3r3xkJBjd698ZCQYGBr169/yQkJBgY3evXgkJCZZVXs3CQkJlld7zu4SEhISRwhSfKcsRmGoc0qQ'
	+ 'qHB+Ntr5bWqaSbVNJNJNJNJNJNI0k0jOwMDSm5ZZZEduHryJ8j17Hr2/9P+uuI8tXq78/tf62I8q/7f6BrQ6/+n+g41YAAAAAAAA'
	+ 'AAAAAAAAAAAH//FMACU//CF6j/////wA/2+msMhal6zfXqtt/9P/bXV8VquMripVzJNn5JJEg1bk0XMP3HtX6jmHFebXREtxedf6'
	+ 'vt3/IkARIZP+Vrjd8tFLGJABj4H/l9+x8D79zVTUbRHSPZP5313i3CbjReVfzvvvvutY5+eeO+q/e/A8ZsJKazZ1/O++61lS55su'
	+ 'c7TlNhjThm09PTzY05Y2XE7TlNhUnDNp6enmxo8VrOzs61MnDNmzZsqKPFMtWqkyScMybNmyoqIUy1atVJKAxps2bGioha8MMJHB'
	+ 'qcccWYHrwwwkcGpxxxZgevDDB3BqcccWZPv76D/Hw2n394T/Hw2/j8Wpes316rbf/T/211fFarjK4qVcyTZ+SSRIAAAAAAAAAAAA'
	+ 'AAAAAAA4//FMACuf/CEY03Xhg0FEvr59vVRn/b/j//zr6y+eokmfbj1ESShmHMRE6CSE7F42IlOSOr1n7d9t/1EQkJEQRQ0k2IRZ'
	+ 'CJQo05Ix8GRLWIbLLfpJoSz0Px3039MREQkIZEAc7AIzZ5KTLIxpBKHFIpWSQkiY5IpiKVkkKInQSMf8D+e+4/UiJCkhkIiGSCMi'
	+ 'ERIASIhkgiIhESAEiAOdgZ1B/y/4/0v6P9L/j/y/o/0v6P4L/j/y/o/0v6P4L8D+C/o/0v6P9L8D+C/A/gu4eyuNeNuNeNuNdjbF'
	+ '2Nhjhjhjhjhi1bNWzVs1bNWzFkDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDA'
	+ 'wMDAwNevXr169evNw/I+vn29VGf9v+P//OvrL56iSZ9uPURJKAAAAAAAAAAAAAAAAAAAAABw//FMACp//CEaj/////8BF3OksVCa'
	+ 'V3xl1ueK/v/7Xd5003cuVSpE5g9iBZgNc8b1X2h/4SD8P+/56zoDnTmf8nbWTBZcy36/OwNyYKF7MIGDiv4PkvVn5Crdx+xx13Be'
	+ 'Gi/X423BhDdtt/7o7whvMet9O40pCw9Hxbzjmyv+16T4j4CN8r4fAYiEr9jNWS4Qe1w9cxhmz1uAyiEr9jNWS4Ue13eQyhjndbgN'
	+ 'ousnlbLOKw95Xd1ywC2d/gJyVJx404oTx7lgoFbr0jRwzVumhA7cpgodtyxMxyyPOW7JM5SynszfKc85bsmzlLKezN8p786rsmzl'
	+ 'LJLM3ynPMbsmzlLJLM3ynvzG7Js5SySMHxCNswPSET4hGWMD0hE+IRljA+AifERljA+LH5PFpXfGXW54r+//td3nTTdy5VKkTmD2'
	+ 'IAAAAAAAAAAAAAAAAAAAAABw//FMAC4f/CEaj/////8BIXSmMJBaZir2pv7f6OM1V2zglSVeTGz5iAtEJEo84ZCBZwNd/8etbeES'
	+ 'MS88ggs0HBCQBe1W6MilHECRYuThEhi/fRsRJAIwVeGEhFs4f8//7xTgwyRQ63yaH2HI31K8vRf6tMfbubq97VpHpL5qL+c7dr78'
	+ '9m7pH5mKedbeo3tWkdFcXN+O42pbVDeB+pkPyuGzX7288V1qT7Drtu61o+B4yw49cqHjN1ksqe+O3Gi41d5HKWG1UzziZVesSeyv'
	+ 'r1Yl9lsKTFPzzYVlerSeyvr1il9lrKSzPzzYSJKOdzq1lHFyL66klzGNIko6bOrXqeLkY2ZPLnmNIZKnbUlkqDYqXTZyZUgNlTtq'
	+ '4ZKg2KkZs5YqQMZrcBpxjCQ8UrkXGYsBpmLCRsUrkM6NRFTQpKSOjURU0KhJSA/J4dMxV7U39v9HGaq7ZwSpKvJjZ8xAAAAAAAAA'
	+ 'AAAAAAAAAAAAAHA=';

export function aacLcAdtsPceFixture(pce = true): Uint8Array<ArrayBuffer> {
	const bytes = Uint8Array.from(Buffer.from(pce ? AAC_ADTS_PCE_1 : AAC_ADTS_PCE_0, 'base64'));
	assert.equal(createHash('sha256').update(bytes).digest('hex'), pce
		? 'e6e41061fe3206720555e3979390ffa018959ab111927139a52849178d3a487b'
		: '3205b84f849a6b88ae5afb7e60bc36a022c6e2e4d3e7cbaafd278197ad0f0d24');
	return bytes;
}
