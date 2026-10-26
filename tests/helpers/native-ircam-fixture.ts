/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { inflateSync } from 'node:zlib';
// Untouched libsndfile1.2.2 SF_FORMAT_IRCAM|SF_FORMAT_PCM_16, sf_writef_float:
// 4800 stereo frames at48000Hz, .15-amplitude200/300Hz tones. Host-endian writer.
// Independent FFmpeg5.1.4/core0.12.10 demux/decode matches every libsndfile sample.
// Format authority: github.com/libsndfile/libsndfile/blob/1.2.2/src/ircam.c
const ENCODED = [
	'eNrt1c9rE80bAPDsbn7sbrI/ZqaCtUgVCiJVpAhV8GCbKl9y82AOpYdA+fKWHgo9VAkEYg0EgvZQ6KH0PRTCl9JDPHjLQZvWg6AFKaJFhIIWqRWc2V/JZjfJ',
	'Zvdd6fe/eGeG5YHnsDDPzPN8/vs/LhJZvvMfNhKJ/Pnooouuf9d6GnkTYZhSuNMsyzJcid3lGK4QXebGYz6nxwrRrbgbnU4sxURej9X5+fiscBznxelETTxI',
	'ZJL3+B/JOp9PXRV46W9hTeLFQfmRuCF/FweUTLKivEw6yrlUTs2n9tSvqSFwS1oEa9IOIBIH78tpuCEXIJZr8I5yCCuKAz8pAF1QR1BOvYGq6k30LYxDYAQ9',
	'BAA9Aw7cAYeQgBochAWYDvc85OBKmK3BRfAODoFjuKc6MKcKyFHOo4oyggaUa2hDHkOD8k20Jo0hXrqG8qkR9CN5HmWSAqqJDuTFYzgrvIN1vgZFfgVOJ+bh',
	'VjwN9dggHI8RUIjugF3uGWC4hyDNDoES8019E6mqkUhOvRtcUIv+J6XRryiBd0eZ9LBc7m3I+937MugSaaazJm27t6S28zWVcfKpzfa5lGu/TGbtTLLe+i5e',
	'bD0SK01edK2/hQXrqnBq1vk58x6PjYNE3phOCMZxvKrPxyd0PXaiLcVWNTc6pRWifeJzDbLMlQnDZUmJHSUsK5ASo2OGOcJPIx9xJPIBPwk+4sA/wkVfx35f',
	'IMX+KAm8LFn2yoT1GqTc6xO+N6WtdFc10D3R1jsT+nCnqm+7gjHm5o3XDjYyzpz5pX1q/tVesFzbtZ7bleYl+2KrHu4Hraz9u+mGmc32lWbGeW+1nQVr20XW',
	'TOeVCbpz5n53wCz33hqTXt4IvOtGo/9TL/pV/W6Q0yORy/qbyIlWYl5oafaxxnBT2i6HwtOdkvFYg+ixdbIVXyLTiSwR+dukzg+TWUEgvOjgmvgLZ5JH+Efy',
	'M86nDjAvfcBr0gEelD/jDfkIDyi/cPiisKMIJKcOkz31NhkCWbIIlsgOWCccbJA0PCUFiLQanNIO4WPNgS80gE60EXRZv4Fy+k1UDeNPfQRdNwDKGw58axzC',
	'AbMG58wCfGWmIbI4uGDtgPfWIrjSHAKV5p76u5lTH7Qcpd6qKJfsAeW5vSG79qD8V3tN+tLmpT+v4LXzIznmZpLbbk0c7vDiemdWAN06v9IVeb43nSj3tuKs',
	'p8eWvfFY4BWixf4u5/cZruin2cAvMU+CN//v37sBwxTDTKPPsoFXYic9hiv3lrn9rs+BbiE603Gj2+5SrO3osYwzH99sH8ddO6yofZCot+7x4T3yleZV4ez9',
	'8eKp+UicM7+L4b0n88bLpGCcS1X1fGpC/5o60W5Jq9qaNKURqU/uyw2yIZcJlrPkjjJKKmGlPyk6vqAe4Zz6EVfVD/hbGIfAEX4IdPwMCGHlRwkJb2EQlsPq',
	'N8g87JOVsPo1uKq9gyfaMZzQHVjVBSQY58OKjyBsXENz5hg6NW+iBWsMudY1VGmOoIut86jeElDWdqBrH8PN9juYcWqw7azAbXceznTSEHQH4X6XgHJvB0x6',
	'z0DgPQSN/hAo+t/Cvj3r3zeRC2qJ+aSk2YrCcHeUXQ7LheiGPB67L+sxIm3F16TpxC1J5L+m/ky6WeFcihdfJmtiJplJfhd/JB+J+TBzNv+uCoNynd+Q7/ED',
	'ykGiokwnHOU4nlPn43uqHhsCS7FF4IbTpBDloM+l4TJXgAxXgyX2ELKsA0sMQAwzgp5GbqBI5CZ6EtxAgT+Cij5Aft+Bxf4hDLwaXPYKkPXSsNzjIB+ebqW7',
	'CEB3CKx39tThTk7ddh1lzK0or51wDjsb8pf22ftzbV56budTl+xwbrcyyQetmvg7nD6V5qxwpVnn31siv2BNJ5C1FX9l6rE5czw2YBaib41dLm8w3HUjzf7U',
	'S0w17Nuz/r0bnGhF/4XW6D/WAm9Km/SQVu6dkv1ug4DuOpnpLJFtN0vazm2ScYbJZlsgru3grP0L11tH+GLrM640D7BrfcAL1gE+NT/jOfMIY+MXDjsOC4ZA',
	'qvowmdBvkxMtS1a1JTKlrZM+aYT7lJQJCrNT2ih5rAnkhabjE+0IX9Y/4pz+AVfD+FM/wtcNPfybQN4ao2TAzJI5s0xemQ2CrD5ZsKa099aqdqV5olWaE/rv',
	'ZlV/0BKMeitvXLKx8dyeM137bP59abtWxqk0XzsXW2NuvRWezB7uuPZ6Z7MNuhlnpdt2+N62W+7NdFgPdJe9/W7glXvF/qTn9wOv6Df6gV/0nwR3A+ov9Zf6',
	'S/2l/lJ/qb/UX+ov9Zf6S/2l/lJ/qb/UX+ov9Zf6S/2l/lJ/qb/UX+ov9Zf6S/2l/lJ/qb/UX+ov9Zf6S/2l/lJ/qb/UX+ov9Zf6S/2l/lJ/qb/UX+ov9Zf6',
	'S/2l/lJ/qb/UX+ov9Zf6S/2l/lJ/qb/UX+ov9fff7O8/NRMNrg==',
].join('');
const REFERENCE = [
	'eNrtl72LVFcYxg9ClsUPVqLRtXIrS0nvnMPa2QhbWFhYbBmw2dJ0N2CxYDOkCKabLpJCtrAQ5j4vs9WmCSzYmEYULJJGCWm2CZvzvPcRSf6FPAvDeOfeez7e',
	'j/PzV8qnv+9ulXJ4qwxlVsrt6TPM+2eYle1V/17Myurj9O/djVrK2359o5bhdFbe1pq/Le7136/XsvWw/36zXw817+096b/d7Z8f+udBv7eYnjn4ud//tpb5',
	'i1q2H9fydUzPDkf9t+/793Ef48f++2/TO/N3tez81L//6PM87+/8Ob07nPTrZX/3tN8/rOXkTMsxylor819reb3eyt6r/ty5lmP9fqGV4ze1bF5sZed9LRe/',
	'bDnm60utrD7Ucv+rVg7+quXZlZZjv7za3/u7lv3N/l5pZetayzke9e/1L1p5yuu16Zpz8f7ibMvnd863fJ9zcrxvNlqO/0ufm/Nxbn7u9H9zPbuXp2f5DNe7',
	'fWUac72Pwf1wLM59p4/N/a42pzVyTsZj99q0l31+93hxbdwzrxlP3mds+DzjzfcZQ47HfHB8xprzMV+cnznhephPro+543qZb66dOeZ+WA/cH2uBe2C9cP+s',
	'GcaD9cS9sLYYL9Yb48c/7qkcLjO+5faY8R7mY+5tezVmPlYfx8zP7gZyj6sbyPy9rch8Lu4h97r1EJnvxYDM/94TTHv+AVkfwwJZLwc/I/c+f4Gsp68DWV/D',
	'ETIGwzFUf8h6nL9DxmL+B7Jet/9E1u9wgozJ3imyvk/ORNZ7WYuMzev1yH4YzkX2x+8XImO0eTGyfy5+GdlPry9Fxur+V5H99uxKZP+9vBoZs/3NyP7cuhbZ',
	'r4/43f+e5vUyr4cyTvd7DPP5Ycz3h8WY4zGWHL+8HXO+4XTM+RlTrqdcR65vuIlcL2PL9W/dRe5n6wGm/THGp9w/cv/bj5HxYKwZn/n3yHgtfkTGjzFnPHd+',
	'Qsa3PEfGm7HP+C+R+dg51LP9GeZr/us05t4rZD45Fuc+foPM98575Bo5J+th9QG5l4O/kPWSa1uxnpD1dFym2HAPrLf1L6YYnqxF1iP3ylgvzkbW6875KSeM',
	'Cev5m40pd7/0WLHeGTvm+E6PJfth93JkLTDG7JftHnPWzHrPAftpygX7LbLfVv2bNcicsR93mcMj9mtkvzK3U/9G9jPvs/b5PPud77NHOB7PA47PXuJ8PC84',
	'P3sua+pcy/WxN7lenjdcP3uY++F5xP2x17lfnlfcP88ExoPnWdZCnneh8y+m8+/MdM345tnS472fZxPyfeaD4zE/HJ/54nzMH+dnPrke5pfrY765Xuaf68+a',
	'6fthfeRZsUTul7WT5/9zZDxYX4wPa4jxmuqvZj0ynp/OAtYr4836zfg/ROaD9Z18uovMF2srmXQTmU/2B/PLGmO+2T/MP/uJ9cBaY32w31gv7D/WD2suedr7',
	'M/na+5X19m/+LsXfUfwdxd9R/B3FX4i/EH8h/kL8hfgL8RfiL8RfiL8QfyH+aq9HEH8/n38TfyH+QvyF+AvxF+JviL8h/ob4G+JviL8h/ob4G+JviL8h/ob4',
	'G+JviL8h/ob4G+JviL8h/ob4G+JviL8h/ob4G+JviL8h/ob4G+JviL8QfyH+QvyF+AvxF+IvxF+IvxB/If5C/IX4C/EX4i/EX4i/EH8h/kL8hfg7ir+j+DuK',
	'v6P4u/wPf2+JvzPxdyb+zsTfmfhbxd8q/lbxt4q/Vfyt4m8Vf6v4W8XfKv5W8beKv1X8/fz/v4m/Vfyt4m8VfzXnaRV/m/jbxN8m/jbxt4m/Tfxt4m8Tf5v4',
	'28TfJv428beJv038beJvE3+b+NvE3yb+NvG3ib9N/G3ibxN/m/jbxN8m/jbxt4m/Vfyt4m8Vf6v4+/n8m/hbxd8q/lbxt4q/Vfyt4m8Vf6v4W8XfKv5W8beK',
	'v1X8reLvTPydib8z8Xcm/t76D3+X4u8o/o7i7yj+juIvxF+IvxB/If5C/IX4C/EX4i/EX4i/EH8h/kL8hfgL8RfiL8RfiL8QfyH+hvgb4m+IvyH+hvgb4m+I',
	'vyH+hvgb4m+IvyH+hvgb4m+IvyH+hvgb4m+IvyH+hvgb4m+IvyH+hvgb4m+IvyH+hvgL8RfiL8RfiL+f//838RfiL8RfiL8QfyH+QvyF+AvxF+IvxF+IvxB/',
	'If5C/B3F31H8HcXfUfxdFvuv/df+a/+1/9p/7b/2X/uv/df+a/+1/9p/7b/2X/uv/df+a/+1/9p/7b/2X/uv/df+a/+1/9p/7b/2X/uv/df+a/+1/9p/7b/2',
	'X/uv/df+a/+1/9p/7b/2X/uv/df+a/+1/9p/7b/2X/uv/df+a/+1/9p/7b/2X/uv/df+a/+1/9p/7b/2X/uv/df+a/+1/9p/7b/2X/uv/df+a/+1/9p/7b/2',
	'X/uv/df+a/+1/9p/7b/2X/uv/df+a/+1/9p/7b/2X/uv/df+a/+1/9p/7b/2X/uv/df+a/+1/9p/7b/2X/uv/df+a/+1/9p/7b/2X/uv/df+a/+1//4v/fcf',
	'iTQikw==',
].join('');
const SHA256 = 'ea712970a185fd0657f3cb504a6a4c6f1a68e24f91b9744cabd28aa5f80f2707';

export function nativeIrcamFixture(): Readonly<{ file: File; channels: readonly Float32Array[] }> {
	const bytes = Uint8Array.from(inflateSync(Buffer.from(ENCODED, 'base64')));
	assert.equal(createHash('sha256').update(bytes).digest('hex'), SHA256);
	const reference = inflateSync(Buffer.from(REFERENCE, 'base64'));
	assert.equal(reference.length, 4800 * 2 * 4);
	return { file: new File([bytes], 'Recording.sf', { type: 'audio/x-ircam' }), channels: [0, 1].map(channel =>
		Float32Array.from({ length: 4800 }, (_, frame) => reference.readFloatLE((frame * 2 + channel) * 4))) };
}
