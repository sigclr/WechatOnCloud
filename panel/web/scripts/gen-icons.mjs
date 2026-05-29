// 生成 PWA / Apple 图标：微信绿圆角方块（纯前端依赖，无需外部工具）。
// 想换成更精致的图标，直接用设计稿替换 public/icon-*.png 即可。
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const COLOR = [7, 193, 96]; // #07C160
const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

function makePng(size) {
  const radius = Math.round(size * 0.22);
  const rowLen = size * 4 + 1;
  const raw = Buffer.alloc(rowLen * size);
  const inRounded = (x, y) => {
    // 圆角：四角之外的像素透明
    const corners = [
      [radius, radius],
      [size - radius, radius],
      [radius, size - radius],
      [size - radius, size - radius],
    ];
    if ((x < radius || x >= size - radius) && (y < radius || y >= size - radius)) {
      const cx = x < radius ? corners[0][0] : corners[1][0];
      const cy = y < radius ? corners[0][1] : corners[2][1];
      return (x - cx) ** 2 + (y - cy) ** 2 <= radius ** 2;
    }
    return true;
  };
  for (let y = 0; y < size; y++) {
    raw[y * rowLen] = 0; // filter type 0
    for (let x = 0; x < size; x++) {
      const o = y * rowLen + 1 + x * 4;
      const on = inRounded(x, y);
      raw[o] = COLOR[0];
      raw[o + 1] = COLOR[1];
      raw[o + 2] = COLOR[2];
      raw[o + 3] = on ? 255 : 0;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

mkdirSync(OUT, { recursive: true });
for (const [name, size] of [
  ['icon-192.png', 192],
  ['icon-512.png', 512],
  ['icon-180.png', 180],
]) {
  writeFileSync(join(OUT, name), makePng(size));
  console.log('generated', name);
}
