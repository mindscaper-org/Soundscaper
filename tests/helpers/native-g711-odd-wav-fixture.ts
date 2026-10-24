/* SPDX-License-Identifier: AGPL-3.0-only */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { inflateSync } from 'node:zlib';
// Untouched libsndfile1.2.2 WAV|ALAW/ULAW,4801 mono frames at48kHz.
// sf_writef_float source: .15-amplitude200Hz sine. Required final RIFF pad retained.
const ALAW_ENCODED = [
	'eJwL8nRz+yLEwBDuGOaalluiAGQysDEwMjTsZgBjRgYOoEhaYnIJC5A+CJROSSxJBNFX7x49+/Xj359Pnz988OjNuxevpk6ZPm3ixAmTJ82dM2f+vHkzZ8yY',
	'PWtWKxC0gEA7FLQhAEwILA9SOGvW7BkzZs6bN3/OnLmTJk+YOHHa9ClTX7149+bRg4fPn/78+/Hr2aN3r8a6+pYW1lampicmJOXkZWSJioiLCQoKCAvJysjI',
	'y8lJSkhIS0mxAgELCLBDARsCwITA8iCFUlLSEhKScnLyMjKyQsICgoJi4iKiWRl5OUkJiemplbWFpb6usaGj/h3176h/R/1Lon9DR/076t9R/476d9S/eP07',
	'UO3J0fgd3vE72t4Yjd/R+B268TvSyueBSs8jLn4ZAOtYjAg=',
].join('');
const ALAW_REFERENCE = [
	'eJzt2qFug1AYxfErkJXISmRfYBmbmuwj8Ah9BEQFYgJZiURWYsi6qSsrkZVXViIrdu5ySGhDQqoWbo74iU208H3555uYMfsXYz5fjYlSYz6ggBosOIjejIkh',
	'gQ2ksIUMdpBDASUcoIKajtDACSycqYMLObhSDzeK3u+tJsQz1k+Y+6yp7398xuHZ+9E7udG7dqMZWM6l4ZyGmVWcY8m55pxzxrmn3EPCvfj9OO6r5v78Hv0+',
	'/V7/9vuFn0/4PRRQgwUH0Tc+BxLYQApbyGAHORRQwgEqqOkIDZzAwpk6uJCDK/Vwo+jn3mpCPGP9hLnPmvr+x2ccnr0fvZMbvWs3moHlXBrOaZhZxTmWnGvO',
	'OWece8o9JNyL34/jvmruz+/R79Pvdd+qX/WrftWv+lW/6lf9ql/1q37Vr/pVv+pX/S6831b9ql/1q37Vr/pVv+pX/apf9at+1a/6Vb/qV/2qX/Wrfv+pX/3/',
	'pPpVv8vtV/dX/arf5far+xt2v/r/jbD71f0Nu1/d37D71f0Nu1/d37D71f0Nu1/d37D71f1Vv+p3uf3q/obdr/5+Drtf3d+w+9X9Dbvf9hcrZKEy',
].join('');
const ALAW_SHA256 = 'eae9cae1196b2299652672cd426d0af826023a0048de400889d77430182a07b9';
const ULAW_ENCODED = [
	'eJwL8nRz+yLEwBDuGOaalluiAGQysDMwMjTsZgBjRgYOoEhaYnIJC5A+CJROSSxJBNH/3z+/f/v65fNnT586cezIoQP79+3ds3vXrp07tm/btnXL5s2bNm7c',
	'sB4I1gHBWjBYgw1ApECKQIo3bNy4afPmLVu3bdu+Y+euXbv37N23/8ChI8dOnDp99vzl67fvP3//Pz89Pjo82N/X28vDzcXJwd7O1sbaysrSwtzMzNTE2NjI',
	'0NBAHwj0gEAXDHSwAYgUSBFIsYGhoZGxsYmpmZm5haWVlbWNrZ29g5OLm4eXt69/cHh0fHp+/ah/R/076t9R/5Lo3/pR/476d9S/o/4d9S9e/w5Ue3I0fod3',
	'/I62N0bjdzR+h278jrTyeaDS84iLXwYAxlX6gg==',
].join('');
const ULAW_REFERENCE = [
	'eJzt06FuwlAUh/GbTSARE4g+Ao9QmJzhEfoIPACWpHOVyMrKSmRhWVKJrMSQVCCQPAD733KatE0qEUu+JZ8YycY95+TnnP/5Dp17Wzj3pWKVqVJdF277vnTb',
	'DxWouQrVSkVqrTZL9xurRO1UqjIrV3tVqNI6qUqdrVrdrLt69LtMPvtNR5q9oLHvGrxp+OZmjnamujNrZfO3uyhsP3lnZ6ntMXnu1e+32XNkew/tDoHdRffx',
	'd2ruldn9/B39Pf1dm/sW+v2gz1WsMlWq60F/f9T/UYGaq1CtVKTWanPUO1SidipVmZWrvSpUaZ1Upc5WrW7WXT36XSY//aYjzV7Q2HcN3jR8czNHO1PdmbWy',
	'+dtdFLafvLOz1PaYPPfq99vsObK9h3aHwO6i+/g7NffK7H7+jv6e/q74xS9+8Ytf/OIXv/jFL37xi1/84he/+MUvfvGLX/ziF7/4xS9+8Ytf/OIXv/jFL37x',
	'i1/84he/+MUvfvGLX/ziF7/4xS9+8Ytf/OIXv/jFL37xi1/84he/+MUvfvGLX/z+T79/a9JkrA==',
].join('');
const ULAW_SHA256 = '499c6bf44ec2545aba5a40aa1d83b26a85ecab970764bdd6c36cf714dfc91009';

const ALAW_EVEN_ENCODED = [
	'eJwL8nRz+yTEwBDuGOaalluiAGQysDEwMjTsZgBjRgYOoEhaYnIJC5A+AJROSSxJBNFX7x49+/Xj359Pnz988OjNuxevpk6ZPm3ixAmTJ82dM2f+vHkzZ8yY',
	'PWtWKxC0gEA7FLQhAEwILA9SOGvW7BkzZs6bN3/OnLmTJk+YOHHa9ClTX7149+bRg4fPn/78+/Hr2aN3r8a6+pYW1lampicmJOXkZWSJioiLCQoKCAvJysjI',
	'y8lJSkhIS0mxAgELCLBDARsCwITA8iCFUlLSEhKScnLyMjKyQsICgoJi4iKiWRl5OUkJiemplbWFpb6usaGj/h3176h/R/1Lon9DR/076t9R/476d9S/eP07',
	'UO3J0fgd3vE72t4Yjd/R+B268TvSyueBSs8jLX4Bh72Lrw==',
].join('');
const ALAW_EVEN_REFERENCE = [
	'eJzt2qFug1AYxfErkJXISmRfYBmbmuwj8Ah9BEQFYgJZiURWYpqxqSsrkZVXViIrdu5ySGhDQqoWbo74iU208H3555uYMfsXYz5fjYlSYz6ggBosOIjejIkh',
	'gQ2ksIUMdpBDASUcoIKajtBACxbO1MGFHFyphxtF7/dWE+IZ6yfMfdbU9z8+4/Ds/eid3Ohdu9EMLOfScE7DzCrOseRcc84549xT7iHhXvx+HPdVc39+j36f',
	'fq9/+/3Czy1+DwXUYMFB9I3PgQQ2kMIWMthBDgWUcIAKajpCAy1YOFMHF3JwpR5uFP3cW02IZ6yfMPdZU9//+IzDs/ejd3Kjd+1GM7CcS8M5DTOrOMeSc805',
	'54xzT7mHhHvx+3HcV839+T36ffq97k/qV/2qX/WrftWv+lW/6lf9ql/1q37Vr/pVvwvv96R+1a/6Vb/qV/2qX/WrftWv+lW/6lf9ql/1q37Vr/pVv//Ur/5/',
	'Uv2q3+X2q/urftXvcvvV/Q27X/3/Rtj96v6G3a/ub9j96v6G3a/ub9j96v6G3a/ub9j96v6qX/W73H51f8PuV38/h92v7m/Y/er+BtzvL6man/k=',
].join('');
const ALAW_EVEN_SHA256 = 'a884732d5001ac721e71859ef3afde40ed0c1f1aabe7f003ec564592de23d8ff';
const ULAW_EVEN_ENCODED = [
	'eJwL8nRz+yTEwBDuGOaalluiAGQysDMwMjTsZgBjRgYOoEhaYnIJC5A+AJROSSxJBNH/3z+/f/v65fNnT586cezIoQP79+3ds3vXrp07tm/btnXL5s2bNm7c',
	'sB4I1gHBWjBYgw1ApECKQIo3bNy4afPmLVu3bdu+Y+euXbv37N23/8ChI8dOnDp99vzl67fvP3//Pz89Pjo82N/X28vDzcXJwd7O1sbaysrSwtzMzNTE2NjI',
	'0NBAHwj0gEAXDHSwAYgUSBFIsYGhoZGxsYmpmZm5haWVlbWNrZ29g5OLm4eXt69/cHh0fHp+/ah/R/076t9R/5Lo3/pR/476d9S/o/4d9S9e/w5Ue3I0fod3',
	'/I62N0bjdzR+h278jrTyeaDS80iLXwCFt/n/',
].join('');
const ULAW_EVEN_REFERENCE = [
	'eJzt06FuwlAUh/GbTSARE4g+Ao9QmJzhEfoIPACWpHOVyMrKSmRhWVKJrMSQVCCQPAD733KatE0qEUu+JZ8YycY95+TnnP/5Dp17Wzj3pWKVqVJdF277vnTb',
	'DxWouQrVSkVqrTZL9xurRO1UqjIrV3tVqNI6qUqdrVrdrLt69LtMPvtNR5q9oLHvGrxp+OZmjnamujNrZfO3uyhsP3lnZ6ntMXnu1e+32XNkew/tDoHdRffx',
	'd2ruldn9/B39Pf1dm/sW+v2gz1WsMlWq60F/f9T/UYGaq1CtVKTWanPUO1SidipVmZWrvSpUaZ1Upc5WrW7WXT36XSY//aYjzV7Q2HcN3jR8czNHO1PdmbWy',
	'+dtdFLafvLOz1PaYPPfq99vsObK9h3aHwO6i+/g7NffK7H7+jv6e/q74xS9+8Ytf/OIXv/jFL37xi1/84he/+MUvfvGLX/ziF7/4xS9+8Ytf/OIXv/jFL37x',
	'i1/84he/+MUvfvGLX/ziF7/4xS9+8Ytf/OIXv/jFL37xi1/84he/+MUvfvGLX/z+P79/2QRkrA==',
].join('');
const ULAW_EVEN_SHA256 = 'ca3dde4564765742ac271983c17443f3c3a64a2ce5e8e484b6a0fe8c3dc434fd';

export function nativeG711OddWavFixture(format: 'alaw' | 'ulaw', frames: 4800 | 4801 = 4801): Readonly<{ file: File; channel: Float32Array }> {
	const bytes = Uint8Array.from(inflateSync(Buffer.from(frames === 4800 ? format === 'alaw' ? ALAW_EVEN_ENCODED : ULAW_EVEN_ENCODED : format === 'alaw' ? ALAW_ENCODED : ULAW_ENCODED, 'base64')));
	assert.equal(createHash('sha256').update(bytes).digest('hex'), frames === 4800 ? format === 'alaw' ? ALAW_EVEN_SHA256 : ULAW_EVEN_SHA256 : format === 'alaw' ? ALAW_SHA256 : ULAW_SHA256);
	const reference = inflateSync(Buffer.from(frames === 4800 ? format === 'alaw' ? ALAW_EVEN_REFERENCE : ULAW_EVEN_REFERENCE : format === 'alaw' ? ALAW_REFERENCE : ULAW_REFERENCE, 'base64'));
	const channel = Float32Array.from({ length: reference.length / 4 }, (_, frame) => reference.readFloatLE(frame * 4));
	return { file: new File([bytes], `Ordinary ${format}.wav`, { type: 'audio/wav' }), channel };
}
