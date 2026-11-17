/**
 * 番茄 APP 正文接口（reading.snssdk.com）纯算法客户端。
 *
 * 移植自 https://github.com/Jees996/fanqie-novel-downloader/blob/main/core/appapi.py
 *
 * 网页版对未登录用户只放前 10 章，APP 接口允许匿名设备免费阅读全书（广告模式）。
 * 流程：设备注册 → 密钥交换 → 签名请求 → AES 解密正文。
 */

'use strict';

const crypto = require('crypto');
const zlib = require('zlib');
const https = require('https');
const { URL } = require('url');
const path = require('path');
const fs = require('fs');
const { app } = require('electron');

// =========================================================================
// 常量（来自 APP 7.0.1.32）
// =========================================================================
const MASK64 = (1n << 64n) - 1n;
const AID = '1967';
const LICENSE_ID = '1611921764';
const SDK_VERSION = 'v04.04.05-ov-android';
const SDK_VERSION_INT = 134744640;
const CALL_TYPE = 738;

const SIGN_KEY = Buffer.from(
  'ac1adaae95a7af94a5114ab3b3a97dd80050aa0a39314c40528caec95256c28c', 'hex');
const SHARED_KEY = Buffer.from([172, 37, 198, 125, 221, 143, 56, 193,
  179, 122, 35, 72, 130, 142, 34, 46]);
const FIXED_STRING = Buffer.from(
  'TdTC5rgxYgkOUrPHpnM7pByyRiuCmrWKGWs521cXdST0m69/COjWjSanLjfBqVovHwWlGJKu8pSXMrYqOKrdWA==', 'base64');

const LOW_RAND = Buffer.from([0xF2, 0x81]);
const HIGH_RAND = Buffer.from([0x61, 0x6F]);
const XOR_PREFIX = Buffer.from([0xF2, 0xF7, 0xFC, 0xFF, 0xF2, 0xF7, 0xFC, 0xFF]);
const ARGUS_HEADER = Buffer.from([0xA6, 0x6E, 0xAD, 0x9F, 0x77, 0x01, 0xD0, 0x0C, 0x18]);

const APP_BASE = 'https://reading.snssdk.com/reading';
// 段评接口在这个域名上明显更快（约 0.5s，reading.snssdk.com 要 3s+）
const COMMENT_HOST = 'https://api5-normal-sinfonlinec.fqnovel.com';
const COMMENT_BASE = `${COMMENT_HOST}/novel/commentapi`;
const APP_UA = 'com.dragon.read';
const REGISTER_URL = 'https://i.snssdk.com/service/2/device_register/?tt_data=a';

const ANDROID_VERSIONS = [['9', 29], ['10', 30], ['11', 31], ['12', 32], ['13', 33], ['14', 34]];
const DEVICE_MODELS = [
  'RMX1931', 'MI8', 'Honor10', 'P30', 'V1921A', 'Redmi Note 7', 'Redmi K20 Pro',
  'MI 9', 'Mi 10 Pro', 'SM-G9750', 'Pixel 6', 'HD1910', 'M2011K2C', 'LIO-AN00',
  'VOG-TL00', 'PCLM10', 'GM1900', 'Pixel 7 Pro', 'Pixel 6a', 'SM-N9760', 'POCO F1',
];
const DEVICE_BRANDS = [
  'realme', 'Xiaomi', 'Huawei', 'OPPO', 'vivo', 'samsung', 'OnePlus',
  'google', 'Redmi', 'HONOR', 'motorola', 'POCO',
];

// 放在 userData 下：打包后 __dirname 位于只读的 app.asar 内，写不进去
const CACHE_PATH = path.join(app.getPath('userData'), 'data', 'device.json');

// =========================================================================
// AES-CBC
// =========================================================================
function aesCbcEncrypt(key, iv, data) {
  const pad = 16 - (data.length % 16);
  const padded = Buffer.concat([data, Buffer.alloc(pad, pad)]);
  const cipher = crypto.createCipheriv('aes-128-cbc', key, iv);
  cipher.setAutoPadding(false);
  return Buffer.concat([cipher.update(padded), cipher.final()]);
}

function aesCbcDecrypt(key, iv, data) {
  const decipher = crypto.createDecipheriv('aes-128-cbc', key, iv);
  decipher.setAutoPadding(false);
  const out = Buffer.concat([decipher.update(data), decipher.final()]);
  if (out.length === 0) return out;
  const padLen = out[out.length - 1];
  return out.subarray(0, out.length - padLen);
}

function md5(data) { return crypto.createHash('md5').update(data).digest(); }
function md5Hex(data) { return crypto.createHash('md5').update(data).digest('hex'); }
function sha512(data) { return crypto.createHash('sha512').update(data).digest(); }

// =========================================================================
// SM3（GB/T 32905-2016）
// =========================================================================
function rotl32(x, n) {
  n &= 31;
  return ((x << n) | (x >>> (32 - n))) >>> 0;
}

function sm3P0(x) { return (x ^ rotl32(x, 9) ^ rotl32(x, 17)) >>> 0; }
function sm3P1(x) { return (x ^ rotl32(x, 15) ^ rotl32(x, 23)) >>> 0; }

function sm3(data) {
  const bitLen = data.length * 8;
  const padded = [];
  for (let i = 0; i < data.length; i++) padded.push(data[i]);
  padded.push(0x80);
  while (padded.length % 64 !== 56) padded.push(0);
  const lenBuf = Buffer.alloc(8);
  lenBuf.writeUInt32BE(Math.floor(bitLen / 0x100000000), 0);
  lenBuf.writeUInt32BE(bitLen >>> 0, 4);
  for (let i = 0; i < 8; i++) padded.push(lenBuf[i]);

  const buf = Buffer.from(padded);
  let state = [0x7380166F, 0x4914B2B9, 0x172442D7, 0xDA8A0600,
    0xA96F30BC, 0x163138AA, 0xE38DEE4D, 0xB0FB0E4E];

  for (let off = 0; off < buf.length; off += 64) {
    const block = buf.subarray(off, off + 64);
    const w = [];
    for (let i = 0; i < 16; i++) w.push(block.readUInt32BE(i * 4));
    for (let i = 16; i < 68; i++) {
      w.push((sm3P1(w[i - 16] ^ w[i - 9] ^ rotl32(w[i - 3], 15))
        ^ rotl32(w[i - 13], 7) ^ w[i - 6]) >>> 0);
    }
    const w1 = [];
    for (let i = 0; i < 64; i++) w1.push((w[i] ^ w[i + 4]) >>> 0);

    let [a, b, c, d, e, f, g, h] = state;
    for (let i = 0; i < 64; i++) {
      const t = i <= 15 ? 0x79CC4519 : 0x7A879D8A;
      const ss1 = rotl32(((rotl32(a, 12) + e + rotl32(t, i)) & 0xFFFFFFFF) >>> 0, 7);
      const ss2 = (ss1 ^ rotl32(a, 12)) >>> 0;
      let ff, gg;
      if (i <= 15) { ff = (a ^ b ^ c) >>> 0; gg = (e ^ f ^ g) >>> 0; }
      else { ff = ((a & b) | (a & c) | (b & c)) >>> 0; gg = ((e & f) | (~e & g)) >>> 0; }
      const tt1 = ((ff + d + ss2 + w1[i]) & 0xFFFFFFFF) >>> 0;
      const tt2 = ((gg + h + ss1 + w[i]) & 0xFFFFFFFF) >>> 0;
      d = c; c = rotl32(b, 9); b = a; a = tt1;
      h = g; g = rotl32(f, 19); f = e; e = sm3P0(tt2);
    }
    state = state.map((x, i) => (x ^ [a, b, c, d, e, f, g, h][i]) >>> 0);
  }
  const result = Buffer.alloc(32);
  state.forEach((v, i) => result.writeUInt32BE(v, i * 4));
  return result;
}

function sm3Prefix6(data) { return sm3(data).subarray(0, 6); }

// =========================================================================
// Simon-4-72（64-bit block cipher，BigInt）
// =========================================================================
function rol64(v, n) { return ((v << BigInt(n)) | (v >> (64n - BigInt(n)))) & MASK64; }
function ror64(v, n) { return ((v << (64n - BigInt(n))) | (v >> BigInt(n))) & MASK64; }

function simonKeyExpand(key) {
  const z4 = 0x3DC94C3A046D678Bn;
  const k = [...key];
  for (let i = 4; i < 72; i++) {
    let tmp = ror64(k[i - 1], 3);
    tmp ^= k[i - 3];
    tmp ^= ror64(tmp, 1);
    const bit = (z4 >> BigInt((i - 4) % 62)) & 1n;
    k.push((~k[i - 4] & MASK64) ^ tmp ^ bit ^ 3n);
  }
  return k;
}

function simonEncrypt(pt, key) {
  const k = simonKeyExpand(key);
  let [x, y] = [pt[0] & MASK64, pt[1] & MASK64];
  for (let i = 0; i < 72; i++) {
    const tmp = y;
    const f = rol64(y, 1) & rol64(y, 8);
    y = (x ^ f ^ rol64(y, 2) ^ k[i]) & MASK64;
    x = tmp;
  }
  return [x, y];
}

// =========================================================================
// SPECK-64（BigInt）
// =========================================================================
function speckKeySchedule(key) {
  const ks = [readLE64(key, 0)];
  const ls = [];
  for (let i = 1; i < key.length / 8; i++) ls.push(readLE64(key, i * 8));
  for (let x = 0; x < 33; x++) {
    const rsX = ((ls[x] << 56n) | (ls[x] >> 8n)) & MASK64;
    const newX = (BigInt(x) ^ ((rsX + ks[x]) & MASK64)) & MASK64;
    const lsY = ((ks[x] >> 61n) | (ks[x] << 3n)) & MASK64;
    ls.push(newX);
    ks.push((newX ^ lsY) & MASK64);
  }
  return ks;
}

function speckEncrypt(key, plaintext) {
  const pad = 16 - (plaintext.length % 16);
  const padded = Buffer.concat([plaintext, Buffer.alloc(pad, pad)]);
  const ks = speckKeySchedule(key);
  const out = [];
  for (let i = 0; i < padded.length; i += 16) {
    let y = readLE64(padded, i);
    let x = readLE64(padded, i + 8);
    for (const k of ks) {
      x = (k ^ ((((x << 56n) | (x >> 8n)) & MASK64) + y) & MASK64) & MASK64;
      y = (x ^ (((y >> 61n) | (y << 3n)) & MASK64)) & MASK64;
    }
    out.push(writeLE64(y), writeLE64(x));
  }
  return Buffer.concat(out);
}

function readLE64(buf, off) {
  const lo = BigInt(buf.readUInt32LE(off));
  const hi = BigInt(buf.readUInt32LE(off + 4));
  return lo | (hi << 32n);
}

function writeLE64(v) {
  const buf = Buffer.alloc(8);
  buf.writeUInt32LE(Number(v & 0xFFFFFFFFn), 0);
  buf.writeUInt32LE(Number((v >> 32n) & 0xFFFFFFFFn), 4);
  return buf;
}

// =========================================================================
// Protobuf Writer（仅 varint / length-delimited）
// =========================================================================
class ProtobufWriter {
  constructor() { this.buf = []; }

  _varint(value) {
    value = BigInt(value) & 0xFFFFFFFFFFFFFFFFn;
    while (value >= 0x80n) {
      this.buf.push(Number(value & 0x7Fn) | 0x80);
      value >>= 7n;
    }
    this.buf.push(Number(value & 0x7Fn));
    return this;
  }

  _key(field, wire) { return this._varint(BigInt(field) * 8n + BigInt(wire)); }

  varint(field, value) { return this._key(field, 0)._varint(value); }

  bytes(field, data) {
    this._key(field, 2)._varint(data.length);
    for (let i = 0; i < data.length; i++) this.buf.push(data[i]);
    return this;
  }

  string(field, value) { return this.bytes(field, Buffer.from(value, 'utf-8')); }

  message(field, buildFn) {
    const sub = new ProtobufWriter();
    buildFn(sub);
    return this.bytes(field, Buffer.from(sub.buf));
  }

  toBuffer() { return Buffer.from(this.buf); }
}

// =========================================================================
// 签名
// =========================================================================
function getArgus(query, xssStub, timestamp) {
  const params = Object.fromEntries(
    query.split('&').filter(p => p.includes('=')).map(p => p.split('=', 2)));
  const deviceId = params.device_id || '';
  const versionName = params.version_name || '';

  const bodyHash = sm3Prefix6(
    !xssStub ? Buffer.alloc(16) : Buffer.from(xssStub.substring(0, 32), 'hex'));
  const queryHash = sm3Prefix6(query ? Buffer.from(query, 'utf-8') : Buffer.alloc(16));

  const pb = new ProtobufWriter();
  pb.varint(1, 0x20200929 * 2);
  pb.varint(2, 2);
  pb.varint(3, crypto.randomInt(0x7FFFFFFF));
  pb.string(4, AID);
  pb.string(5, deviceId);
  pb.string(6, LICENSE_ID);
  pb.string(7, versionName);
  pb.string(8, SDK_VERSION);
  pb.varint(9, SDK_VERSION_INT);
  pb.bytes(10, Buffer.alloc(8));
  pb.varint(11, 0);
  pb.varint(12, timestamp * 2);
  pb.bytes(13, bodyHash);
  pb.bytes(14, queryHash);
  pb.message(15, sub => {
    sub.varint(1, 1); sub.varint(2, 1); sub.varint(3, 1); sub.varint(7, 3348294860);
  });
  pb.string(16, '');
  pb.string(20, 'none');
  pb.varint(21, CALL_TYPE);
  pb.message(23, sub => {
    sub.string(1, 'NX551J'); sub.varint(2, 8196); sub.varint(4, 2162219008);
  });
  pb.varint(25, 2);

  let protobuf = pb.toBuffer();
  const pbPad = 16 - (protobuf.length % 16);
  protobuf = Buffer.concat([protobuf, Buffer.alloc(pbPad, pbPad)]);

  const digest = sm3(Buffer.concat([SIGN_KEY, LOW_RAND, HIGH_RAND, SIGN_KEY]));
  const key = [readLE64(digest, 0), readLE64(digest, 8),
    readLE64(digest, 16), readLE64(digest, 24)];

  const encrypted = [];
  for (let off = 0; off < protobuf.length; off += 16) {
    const low = readLE64(protobuf, off);
    const high = readLE64(protobuf, off + 8);
    const [eLow, eHigh] = simonEncrypt([low, high], key);
    encrypted.push(writeLE64(eLow), writeLE64(eHigh));
  }

  const data = Buffer.concat([XOR_PREFIX, Buffer.concat(encrypted)]);
  for (let i = 8; i < data.length; i++) data[i] ^= data[i % 8];
  data.reverse();

  const plaintext = Buffer.concat([ARGUS_HEADER, data, HIGH_RAND]);
  const ciphertext = aesCbcEncrypt(md5(SIGN_KEY.subarray(0, 16)), md5(SIGN_KEY.subarray(16)), plaintext);
  return Buffer.concat([LOW_RAND, ciphertext]).toString('base64');
}

function getLadon(timestamp) {
  const randomBytes = crypto.randomBytes(4);
  const plaintext = Buffer.from(`${timestamp}-${LICENSE_ID}-${AID}`, 'utf-8');
  const key = Buffer.from(md5Hex(Buffer.concat([randomBytes, Buffer.from(AID)])), 'utf-8');
  return Buffer.concat([randomBytes, speckEncrypt(key, plaintext)]).toString('base64');
}

function signRequest(url, body) {
  const parsed = new URL(url);
  const rawQuery = parsed.search.substring(1);
  const xssStub = body ? md5Hex(body) : '';
  const nowMs = Date.now();
  const ts = Math.floor(nowMs / 1000);
  const headers = {
    'x-argus': getArgus(rawQuery, xssStub, ts),
    'x-ladon': getLadon(ts),
    'x-khronos': String(ts),
    'x-ss-req-ticket': String(nowMs),
  };
  if (body) headers['X-SS-STUB'] = xssStub;
  return headers;
}

// =========================================================================
// TTEncrypt（设备注册请求体加密）
// =========================================================================
function ttEncrypt(data) {
  const randomBytes = crypto.randomBytes(32);
  const hashValue = sha512(Buffer.concat([sha512(randomBytes), FIXED_STRING]));
  const key = hashValue.subarray(0, 16);
  const iv = hashValue.subarray(16, 32);
  const compressed = zlib.gzipSync(data, { level: zlib.constants.Z_DEFAULT_COMPRESSION });
  const encrypted = aesCbcEncrypt(key, iv, Buffer.concat([sha512(compressed), compressed]));
  return Buffer.concat([Buffer.from([116, 99, 5, 16, 0, 0]), randomBytes, encrypted]);
}

// =========================================================================
// 设备注册
// =========================================================================
function randHex(k) {
  return [...crypto.randomBytes(k)].map(b => '0123456789abcdef'[b % 16]).join('');
}

function uuid() {
  const b = crypto.randomBytes(16);
  b[6] = (b[6] & 0x0F) | 0x40;
  b[8] = (b[8] & 0x3F) | 0x80;
  const h = b.toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

function ipv6UniqueLocal() {
  const prefix = `fd${randHex(2)}`;
  let addr = prefix;
  for (let i = 0; i < 7; i++) addr += ':' + randHex(4);
  return addr;
}

function buildRegisterBody() {
  const [osVersion, osApi] = ANDROID_VERSIONS[Math.floor(Math.random() * ANDROID_VERSIONS.length)];
  const brand = DEVICE_BRANDS[Math.floor(Math.random() * DEVICE_BRANDS.length)];
  const genTime = Date.now();
  const romVersion = `coloros__${randHex(4).toUpperCase()}.${String(Math.floor(Math.random() * 1e6)).padStart(6, '0')}.${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')} release-keys`;
  return {
    magic_tag: 'ss_app_log',
    header: {
      display_name: '番茄免费小说', aid: 1967, channel: '43536163a',
      package: 'com.dragon.read', sdk_version: '3.7.0-rc.25-fanqie-xiaoshuo',
      sdk_target_version: 29, git_hash: '711d1a7', density_dpi: 240,
      display_density: 'hdpi', resolution: '720x1280', language: 'zh',
      timezone: 8, access: 'wifi', not_request_sender: 0,
      carrier: 'CHINA MOBILE', mcc_mnc: '46000', region: 'CN',
      tz_name: 'Asia/Shanghai', tz_offset: 28800, sim_region: 'cn',
      sim_serial_number: [], oaid_may_support: false,
      device_platform: 'android',
      custom: { host_bit: 32, dragon_device_type: 0 },
      pre_installed_channel: '', is_system_app: 0, sdk_flavor: 'china',
      guest_mode: 0, os: 'Android', os_version: osVersion, os_api: osApi,
      device_model: DEVICE_MODELS[Math.floor(Math.random() * DEVICE_MODELS.length)],
      device_brand: brand, device_manufacturer: brand, cpu_abi: 'arm64-v8a',
      release_build: randHex(7), cdid: uuid(),
      sig_hash: 'a4a27c2633195374c15651ffc3c4a497', openudid: randHex(20),
      clientudid: uuid(), req_id: uuid(),
      rom: randHex(14).toUpperCase(), rom_version: romVersion,
      apk_first_install_time: genTime - Math.floor(Math.random() * 365) * 86400000,
      ipv6_list: [
        { type: 'client_anpi', value: '::1' },
        { type: 'client_anpi', value: ipv6UniqueLocal() },
        { type: 'client_anpi', value: ipv6UniqueLocal() },
      ],
    },
    _gen_time: genTime,
  };
}

function buildQuery(device, extra) {
  const params = {
    iid: device.install_id, device_id: device.device_id,
    ac: 'wifi', channel: '43536163a', aid: AID, app_name: 'novelapp',
    version_code: '70132', version_name: '7.0.1.32',
    device_platform: 'android', os: 'android', ssmix: 'a', os_version: '10',
    device_type: device.device_type || 'P30',
    device_brand: device.device_brand || 'realme',
    update_version_code: '70132', manifest_version_code: '70132',
    pv_player: '70132',
    ...extra,
  };
  return new URLSearchParams(params).toString();
}

function reverseHex(deviceId) {
  const be = BigInt(deviceId).toString(16).padStart(32, '0');
  let result = '';
  for (let i = be.length; i > 0; i -= 2) result += be.slice(i - 2, i);
  return result;
}

// =========================================================================
// HTTPS 请求（直连，snssdk.com 已在代理中设为 DIRECT）
// =========================================================================
function httpsRequest(url, { method = 'GET', headers = {}, body = null, timeout = 30000 } = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const opts = {
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      method,
      headers: { 'User-Agent': APP_UA, Accept: '*/*', ...headers },
      timeout,
    };
    const req = https.request(opts, res => {
      const data = [];
      res.on('data', c => data.push(c));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(data), headers: res.headers }));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
    if (body) req.write(body);
    req.end();
  });
}

// =========================================================================
// 正文解析
// =========================================================================
const STYLE_RE = /<style[^>]*>.*?<\/style>/gis;
const H1_RE = /<h1[^>]*>(.*?)<\/h1>/is;
const P_RE = /<p(\s[^>]*)?>(.*?)<\/p>/gis;
const IDX_RE = /\sidx="(\d+)"/;
const BLK_RE = /<blk(?:\s[^>]*)?>(.*?)<\/blk>/gis;
const TAG_RE = /<[^>]+>/g;

function cleanFragment(fragment) {
  let text = fragment.replace(TAG_RE, '');
  text = text.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&#x27;/g, "'")
    .replace(/&nbsp;/g, ' ');
  text = text.replace(/​/g, '').replace(/﻿/g, '').replace(/　/g, ' ');
  text = text.replace(/[ \t\r\f\v ]+/g, ' ');
  return text.trim();
}

function parseChapterXhtml(xhtml) {
  if (!xhtml) return { title: '', paragraphs: [], paraIdx: [] };
  xhtml = xhtml.replace(STYLE_RE, '');

  let title = '';
  const h1Match = H1_RE.exec(xhtml);
  if (h1Match) title = cleanFragment(h1Match[1]);

  // paraIdx 是段落在原文里的 idx 属性，段评按它定位；没有时记 -1
  const paragraphs = [];
  const paraIdx = [];
  let m;
  P_RE.lastIndex = 0;
  while ((m = P_RE.exec(xhtml)) !== null) {
    const text = cleanFragment(m[2]);
    if (!text) continue;
    const idx = IDX_RE.exec(m[1] || '');
    paragraphs.push(text);
    paraIdx.push(idx ? Number(idx[1]) : -1);
  }
  if (paragraphs.length === 0) {
    BLK_RE.lastIndex = 0;
    while ((m = BLK_RE.exec(xhtml)) !== null) {
      const text = cleanFragment(m[1]);
      if (text && text !== title) { paragraphs.push(text); paraIdx.push(-1); }
    }
  }
  return { title, paragraphs, paraIdx };
}

// =========================================================================
// 段评：评论和回复结构相同，只是公共块一个叫 common、一个叫 Common
// =========================================================================
// 回复里的 comment_id 是它所属的一级评论，自己的 id 在 reply_id
function flattenComment(c, isReply = false) {
  const cm = c.common || c.Common || {};
  const user = cm.user_info || {};
  const base = user.base_info || {};
  const tag = user.user_tag || {};
  const stat = c.stat || c.Stat || {};
  const replyTo = (c.reply_to_user_info || {}).base_info || {};
  return {
    id: String((isReply ? c.reply_id : c.comment_id) || c.comment_id || ''),
    isReply,
    userId: String(user.user_id || base.user_id || ''),
    serviceId: Number(cm.service_id) || 1,
    liked: !!(c.user_action || {}).user_digg,
    text: (cm.content || {}).text || '',
    time: Number(cm.create_timestamp) || 0,
    userName: base.user_name || '番茄用户',
    avatar: base.user_avatar || '',
    isAuthor: !!tag.is_author,
    isVip: !!tag.is_vip,
    titles: (tag.user_title_info || []).map(t => t.zh_title).filter(Boolean),
    diggCount: Number(stat.digg_count) || 0,
    replyCount: Number(stat.reply_count) || 0,
    authorLiked: !!(c.user_action || {}).author,
    replyTo: replyTo.user_name || '',
  };
}

// =========================================================================
// FanqieAppApi 客户端
// =========================================================================
class FanqieAppApi {
  constructor({ timeout = 30000, interval = 6, batchSize = 30, maxDevices = 3 } = {}) {
    this.timeout = timeout;
    this.interval = interval * 1000;
    this.batchSize = Math.min(30, Math.max(1, batchSize));
    this.maxDevices = maxDevices;
    this.device = null;
    this.key = null;
    this.keyVersion = null;
    this.devicesMade = 0;
    this._lastRequest = 0;
  }

  // ----- 缓存
  _loadCache() {
    try {
      if (!fs.existsSync(CACHE_PATH)) return false;
      const data = JSON.parse(fs.readFileSync(CACHE_PATH, 'utf-8'));
      const device = data.device || {};
      if (!device.device_id || !device.install_id) return false;
      this.device = device;
      if (data.key) {
        this.key = Buffer.from(data.key, 'hex');
        this.keyVersion = data.key_version;
      }
      return true;
    } catch { return false; }
  }

  _saveCache() {
    try {
      const payload = {
        device: this.device,
        key: this.key ? this.key.toString('hex') : '',
        key_version: this.keyVersion,
        updated_at: Math.floor(Date.now() / 1000),
      };
      fs.mkdirSync(path.dirname(CACHE_PATH), { recursive: true });
      fs.writeFileSync(CACHE_PATH, JSON.stringify(payload, null, 2), 'utf-8');
    } catch {}
  }

  // ----- 注册
  async _registerDevice() {
    const body = buildRegisterBody();
    const plain = Buffer.from(JSON.stringify(body), 'utf-8');
    const encrypted = ttEncrypt(plain);
    const res = await httpsRequest(REGISTER_URL, {
      method: 'POST',
      headers: { 'User-Agent': 'okhttp/4.10.0', 'Content-Type': 'application/octet-stream; tt-data=a' },
      body: encrypted,
      timeout: this.timeout,
    });
    const payload = JSON.parse(res.body.toString('utf-8'));
    if (!payload.device_id_str || !payload.install_id_str) {
      throw new Error('匿名设备注册失败：响应缺少 device_id / install_id');
    }
    const device = {
      device_id: String(payload.device_id_str),
      install_id: String(payload.install_id_str),
      device_type: body.header.device_model,
      device_brand: body.header.device_brand,
    };
    this.devicesMade++;
    return device;
  }

  async _registerKey() {
    if (!this.device) throw new Error('尚未注册设备');
    const url = `${APP_BASE}/crypt/registerkey?${buildQuery(this.device)}`;
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    const iv = Buffer.from(Array.from({ length: 16 }, () => chars[Math.floor(Math.random() * chars.length)]).join(''));
    const data = Buffer.from(reverseHex(this.device.device_id), 'hex').subarray(0, 8);
    const bodyObj = { content: Buffer.concat([iv, aesCbcEncrypt(SHARED_KEY, iv, data)]).toString('base64') };
    const bodyBuf = Buffer.from(JSON.stringify(bodyObj), 'utf-8');
    const headers = signRequest(url, bodyBuf);
    headers['Content-Type'] = 'application/json; charset=utf-8';
    const res = await httpsRequest(url, { method: 'POST', headers, body: bodyBuf, timeout: this.timeout });
    const payload = JSON.parse(res.body.toString('utf-8'));
    const dataObj = payload.data || {};
    if (!dataObj.key) throw new Error('正文密钥注册失败：响应缺少 key');
    const raw = Buffer.from(dataObj.key, 'base64');
    this.key = aesCbcDecrypt(SHARED_KEY, raw.subarray(0, 16), raw.subarray(16));
    this.keyVersion = dataObj.keyver;
  }

  async ensureReady() {
    if (this.device && this.key) return;
    if (!this.device) {
      if (!this._loadCache()) this.device = await this._registerDevice();
    }
    if (!this.key) await this._registerKey();
    this._saveCache();
  }

  async _recoverDevice() {
    if (this.devicesMade >= this.maxDevices) {
      throw new Error('APP 接口持续返回空响应，设备注册次数已达上限');
    }
    this.device = await this._registerDevice();
    this.key = null;
    await this._registerKey();
    this._saveCache();
  }

  // ----- 请求
  async _throttle() {
    const wait = this.interval - (Date.now() - this._lastRequest);
    if (wait > 0) await new Promise(r => setTimeout(r, wait));
  }

  async _fetchBatch(itemIds, bookId) {
    await this.ensureReady();
    await this._throttle();
    const url = `${APP_BASE}/reader/batch_full/v?${buildQuery(this.device, {
      item_ids: itemIds.join(','),
      book_id: bookId || '0',
      novel_text_type: '1',
      req_type: '1',
    })}`;
    const headers = signRequest(url);
    const res = await httpsRequest(url, { headers, timeout: this.timeout });
    this._lastRequest = Date.now();
    if (res.status !== 200) throw new Error(`章节接口返回 HTTP ${res.status}`);
    if (!res.body.length) throw new Error('章节接口返回空响应（设备可能被作废）');
    const payload = JSON.parse(res.body.toString('utf-8'));
    const data = payload.data;
    if (!data || typeof data !== 'object' || Object.keys(data).length === 0) {
      throw new Error('章节接口返回空响应（设备可能被作废）');
    }

    const result = {};
    let invalid = 0;
    for (const [itemId, item] of Object.entries(data)) {
      const content = item.content;
      if (!content || content === 'Invalid') {
        if (content === 'Invalid') invalid++;
        continue;
      }
      const raw = Buffer.from(content, 'base64');
      let plain = aesCbcDecrypt(this.key, raw.subarray(0, 16), raw.subarray(16));
      if (item.compress_status === 1) plain = zlib.gunzipSync(plain);
      result[String(itemId)] = plain.toString('utf-8');
    }
    if (Object.keys(result).length === 0 && invalid) {
      throw new Error('正文密钥失效，需要重新注册');
    }
    return result;
  }

  // ----- 对外接口
  // 只取第一页；翻页需带上一页返回的 search_id 与 passback，前端暂未用到
  async searchBooks(query) {
    await this.ensureReady();
    const url = `${APP_BASE}/bookapi/search/page/v/?${buildQuery(this.device, {
      query, offset: '0', count: '10',
    })}`;
    const res = await httpsRequest(url, { headers: signRequest(url), timeout: this.timeout });
    if (res.status !== 200 || !res.body.length) throw new Error(`搜索接口返回 HTTP ${res.status}`);
    const payload = JSON.parse(res.body.toString('utf-8'));
    if (payload.code !== 0) throw new Error(`搜索接口错误：${payload.message}`);
    const books = (payload.data || [])
      .map(cell => (cell.book_data || [])[0])
      // book_type 为 1 的是有声书，没有文字正文
      .filter(b => b && b.book_id && String(b.book_type) !== '1')
      .map(b => ({
        id: String(b.book_id),
        title: b.book_name || '',
        author: b.author || '',
        cover: b.thumb_url || '',
        description: b.abstract || '',
        category: b.category || '',
        wordCount: Number(b.word_number) || 0,
        status: String(b.creation_status) === '0' ? '已完结' : '连载中',
        latestChapter: b.last_chapter_title || '',
      }));
    return { books, total: books.length, hasMore: !!payload.has_more };
  }

  // ----- 段评（不需要登录；签名只覆盖 URL，body 不参与）
  // 读接口带上 Cookie 才知道「我赞过没有」；写接口必须带。cookie 由主进程注入
  async _commentCall(path, body, { write = false, host = COMMENT_BASE } = {}) {
    await this.ensureReady();
    const cookie = this.getCookie ? this.getCookie() : '';
    if (write && !cookie) throw new Error('请先登录番茄账号');
    const url = `${host}${path}?${buildQuery(this.device, { compliance_status: '0' })}`;
    const buf = body ? Buffer.from(JSON.stringify(body)) : null;
    // 写操作把 body 一起签（X-SS-STUB）；读接口只签 URL 就行
    const headers = write ? signRequest(url, buf) : signRequest(url);
    if (cookie) headers.Cookie = cookie;
    if (buf) headers['Content-Type'] = 'application/json; charset=utf-8';
    const res = await httpsRequest(url, buf
      ? { method: 'POST', headers, body: buf, timeout: 15000 }
      : { headers, timeout: 15000 });
    const payload = res.body.length ? JSON.parse(res.body.toString('utf-8')) : null;
    if (!payload) throw new Error('评论接口返回空响应');
    const code = Number(payload.code);
    if (code === 103006) throw new Error('番茄登录已失效，请重新登录');
    if (code !== 0) throw new Error(payload.message || `评论接口错误 ${payload.code}`);
    return payload.data || {};
  }

  // 返回 { 段落idx: 评论数 }
  async commentStats(itemId) {
    const data = await this._commentCall(`/idea/list/${itemId}/v1/`);
    const stats = {};
    for (const [idx, v] of Object.entries(data.data || {})) {
      const n = Number((v || {}).count) || 0;
      if (n > 0) stats[idx] = n;
    }
    return stats;
  }

  // sort：1 热门，3 最新
  async commentList(itemId, bookId, paraIndex, cursor = '', sort = 1) {
    const data = await this._commentCall(`/comment/list/${itemId}/v1/`, {
      chapter_id: String(itemId), comment_source: 2, comment_type: 1, group_type: 15,
      count: 20, sort, cursor,
      business_param: { book_id: String(bookId), item_version: '0', para_index: Number(paraIndex) },
    });
    const info = data.common_list_info || {};
    return {
      comments: (data.data_list || []).map(x => x.comment).filter(Boolean).map(flattenComment),
      cursor: String(info.cursor || ''),
      hasMore: !!info.has_more,
      total: Number(info.total) || 0,
    };
  }

  async commentReplies(commentId, cursor = '') {
    const data = await this._commentCall(`/reply/list/${commentId}/v1/`, {
      comment_id: String(commentId), comment_source: 5, comment_type: 1, group_type: 15,
      count: 20, cursor,
    });
    const info = data.common_list_info || {};
    return {
      replies: (data.reply_list || []).map(r => flattenComment(r, true)),
      cursor: String(info.cursor || data.cursor || ''),
      hasMore: !!(info.has_more ?? data.has_more),
    };
  }

  // 发段评/回复都要带上所在段落的位置
  _paraBusiness(bookId, paraIndex, paraText) {
    return {
      book_id: String(bookId),
      item_version: '0',
      para_content: paraText,
      pos_v1: {
        start_para_index: Number(paraIndex), end_para_index: Number(paraIndex),
        start_word_pos: 0, end_word_pos: paraText.length,
        start_media_index: 0, end_media_index: 0,
      },
    };
  }

  async commentAdd(itemId, bookId, paraIndex, paraText, text) {
    const data = await this._commentCall('/comment/add/v1/', {
      text, group_id: String(itemId), group_type: 15, data_type: 1, comment_type: 0, commit_source: 2,
      business_param: this._paraBusiness(bookId, paraIndex, paraText),
    }, { write: true });
    const c = data.comment_info || data.comment;
    if (!c) throw new Error('番茄没有确认段评发送结果，请稍后刷新查看');
    return flattenComment(c);
  }

  // target 是被回复的那条回复（回复楼中楼时才有）
  async replyAdd(itemId, bookId, paraIndex, paraText, rootId, toUserId, text, toReplyId = '') {
    const body = {
      text, group_id: String(itemId), group_type: 15, data_type: 1, commit_source: 8,
      reply_to_comment_id: String(rootId),
      reply_to_userid: String(toUserId || ''),
      business_param: this._paraBusiness(bookId, paraIndex, paraText),
    };
    if (toReplyId) body.reply_to_replyid = String(toReplyId);
    const data = await this._commentCall('/reply/add/v1/', body, { write: true });
    const r = data.reply || data.reply_info;
    if (!r) throw new Error('番茄没有确认回复发送结果，请稍后刷新查看');
    return flattenComment(r, true);
  }

  // digg_type：1 点赞 / 3 取消；target_type：1 评论 / 2 回复
  async commentDigg(bookId, id, like, isReply, serviceId = 1) {
    await this._commentCall('/reading/ugc/novel_comment/digg/v', {
      book_id: String(bookId), comment_id: String(id),
      digg_type: like ? 1 : 3, target_type: isReply ? 2 : 1, service_id: serviceId || 1,
    }, { write: true, host: COMMENT_HOST });
  }

  async fetchChapters(itemIds, bookId = '', { onBatch, maxRounds = 3 } = {}) {
    let pending = itemIds.map(String).filter(Boolean);
    const result = {};
    if (!pending.length) return result;

    for (let rnd = 0; rnd < Math.max(1, maxRounds); rnd++) {
      if (!pending.length) break;
      if (rnd > 0) await new Promise(r => setTimeout(r, Math.max(this.interval, 8000)));
      const stillMissing = [];
      for (let start = 0; start < pending.length; start += this.batchSize) {
        const batch = pending.slice(start, start + this.batchSize);
        if (start > 0) await this._throttle();
        let got;
        try {
          got = await this._fetchBatch(batch, bookId);
        } catch (err) {
          const message = err.message;
          if (message.includes('空响应')) {
            await new Promise(r => setTimeout(r, 15000));
            await this._recoverDevice();
            got = await this._fetchBatch(batch, bookId);
          } else if (message.includes('密钥失效')) {
            this.key = null;
            await this._registerKey();
            got = await this._fetchBatch(batch, bookId);
          } else throw err;
        }
        Object.assign(result, got);
        for (const id of batch) { if (!got[id]) stillMissing.push(id); }
        if (onBatch) try { onBatch(batch, got); } catch {}
      }
      pending = stillMissing;
    }
    return result;
  }

  async fetchChapter(itemId, bookId = '') {
    const result = await this.fetchChapters([itemId], bookId);
    const xhtml = result[String(itemId)];
    if (!xhtml) throw new Error('该章节未能获取正文');
    return parseChapterXhtml(xhtml);
  }
}

module.exports = { FanqieAppApi, parseChapterXhtml, signRequest };
