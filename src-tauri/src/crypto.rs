//! 番茄 APP 接口用到的密码学原语与请求签名（x-argus / x-ladon）。
//! 移植自原 Node 实现，算法细节（含各处常量）必须逐位一致。

use aes::Aes128;
use cbc::cipher::{block_padding::NoPadding, BlockDecryptMut, BlockEncryptMut, KeyIvInit};
use md5::{Digest as _, Md5};
use rand::Rng;
use sha2::Sha512;

use crate::util::R;

const AID: &str = "1967";
const LICENSE_ID: &str = "1611921764";
const SDK_VERSION: &str = "v04.04.05-ov-android";
const SDK_VERSION_INT: u64 = 134744640;
const CALL_TYPE: u64 = 738;

pub const SIGN_KEY: [u8; 32] = [
    0xac, 0x1a, 0xda, 0xae, 0x95, 0xa7, 0xaf, 0x94, 0xa5, 0x11, 0x4a, 0xb3, 0xb3, 0xa9, 0x7d, 0xd8,
    0x00, 0x50, 0xaa, 0x0a, 0x39, 0x31, 0x4c, 0x40, 0x52, 0x8c, 0xae, 0xc9, 0x52, 0x56, 0xc2, 0x8c,
];
pub const SHARED_KEY: [u8; 16] = [
    172, 37, 198, 125, 221, 143, 56, 193, 179, 122, 35, 72, 130, 142, 34, 46,
];
pub const FIXED_STRING_B64: &str =
    "TdTC5rgxYgkOUrPHpnM7pByyRiuCmrWKGWs521cXdST0m69/COjWjSanLjfBqVovHwWlGJKu8pSXMrYqOKrdWA==";

const LOW_RAND: [u8; 2] = [0xF2, 0x81];
const HIGH_RAND: [u8; 2] = [0x61, 0x6F];
const XOR_PREFIX: [u8; 8] = [0xF2, 0xF7, 0xFC, 0xFF, 0xF2, 0xF7, 0xFC, 0xFF];
const ARGUS_HEADER: [u8; 9] = [0xA6, 0x6E, 0xAD, 0x9F, 0x77, 0x01, 0xD0, 0x0C, 0x18];

// ------------------------------------------------------------------ 哈希 / AES
pub fn md5(data: &[u8]) -> [u8; 16] {
    Md5::digest(data).into()
}

pub fn md5_hex(data: &[u8]) -> String {
    hex::encode(md5(data))
}

pub fn sha512(data: &[u8]) -> [u8; 64] {
    Sha512::digest(data).into()
}

/// AES-128-CBC，补 PKCS7 风格的填充（长度恰为 16 的倍数时补满一块）
pub fn aes_cbc_encrypt(key: &[u8], iv: &[u8], data: &[u8]) -> R<Vec<u8>> {
    let pad = 16 - data.len() % 16;
    let mut buf = data.to_vec();
    buf.extend(std::iter::repeat(pad as u8).take(pad));
    let enc = cbc::Encryptor::<Aes128>::new_from_slices(key, iv)
        .map_err(|e| format!("AES 参数错误：{e}"))?;
    Ok(enc.encrypt_padded_vec_mut::<NoPadding>(&buf))
}

/// 解密后按末字节去填充；填充长度超出时不报错，沿用原实现的宽松行为
pub fn aes_cbc_decrypt(key: &[u8], iv: &[u8], data: &[u8]) -> R<Vec<u8>> {
    let dec = cbc::Decryptor::<Aes128>::new_from_slices(key, iv)
        .map_err(|e| format!("AES 参数错误：{e}"))?;
    let mut out = dec
        .decrypt_padded_vec_mut::<NoPadding>(data)
        .map_err(|e| format!("AES 解密失败：{e}"))?;
    if let Some(&pad) = out.last() {
        let keep = out.len().saturating_sub(pad as usize);
        out.truncate(keep);
    }
    Ok(out)
}

// ------------------------------------------------------------------ SM3（GB/T 32905-2016）
fn p0(x: u32) -> u32 {
    x ^ x.rotate_left(9) ^ x.rotate_left(17)
}

fn p1(x: u32) -> u32 {
    x ^ x.rotate_left(15) ^ x.rotate_left(23)
}

pub fn sm3(data: &[u8]) -> [u8; 32] {
    let bit_len = (data.len() as u64) * 8;
    let mut msg = data.to_vec();
    msg.push(0x80);
    while msg.len() % 64 != 56 {
        msg.push(0);
    }
    msg.extend_from_slice(&bit_len.to_be_bytes());

    let mut state: [u32; 8] = [
        0x7380166F, 0x4914B2B9, 0x172442D7, 0xDA8A0600, 0xA96F30BC, 0x163138AA, 0xE38DEE4D,
        0xB0FB0E4E,
    ];
    for block in msg.chunks(64) {
        let mut w = [0u32; 68];
        for i in 0..16 {
            w[i] = u32::from_be_bytes(block[i * 4..i * 4 + 4].try_into().unwrap());
        }
        for i in 16..68 {
            w[i] = p1(w[i - 16] ^ w[i - 9] ^ w[i - 3].rotate_left(15))
                ^ w[i - 13].rotate_left(7)
                ^ w[i - 6];
        }
        let [mut a, mut b, mut c, mut d, mut e, mut f, mut g, mut h] = state;
        for i in 0..64usize {
            let t: u32 = if i <= 15 { 0x79CC4519 } else { 0x7A879D8A };
            let ss1 = a
                .rotate_left(12)
                .wrapping_add(e)
                .wrapping_add(t.rotate_left((i % 32) as u32))
                .rotate_left(7);
            let ss2 = ss1 ^ a.rotate_left(12);
            let (ff, gg) = if i <= 15 {
                (a ^ b ^ c, e ^ f ^ g)
            } else {
                ((a & b) | (a & c) | (b & c), (e & f) | (!e & g))
            };
            let tt1 = ff
                .wrapping_add(d)
                .wrapping_add(ss2)
                .wrapping_add(w[i] ^ w[i + 4]);
            let tt2 = gg.wrapping_add(h).wrapping_add(ss1).wrapping_add(w[i]);
            d = c;
            c = b.rotate_left(9);
            b = a;
            a = tt1;
            h = g;
            g = f.rotate_left(19);
            f = e;
            e = p0(tt2);
        }
        for (s, v) in state.iter_mut().zip([a, b, c, d, e, f, g, h]) {
            *s ^= v;
        }
    }
    let mut out = [0u8; 32];
    for (i, v) in state.iter().enumerate() {
        out[i * 4..i * 4 + 4].copy_from_slice(&v.to_be_bytes());
    }
    out
}

fn sm3_prefix6(data: &[u8]) -> [u8; 6] {
    sm3(data)[..6].try_into().unwrap()
}

// ------------------------------------------------------------------ Simon-4-72（64 位分组）
fn simon_key_expand(key: [u64; 4]) -> Vec<u64> {
    const Z4: u64 = 0x3DC94C3A046D678B;
    let mut k: Vec<u64> = key.to_vec();
    for i in 4..72 {
        let mut tmp = k[i - 1].rotate_right(3);
        tmp ^= k[i - 3];
        tmp ^= tmp.rotate_right(1);
        let bit = (Z4 >> ((i - 4) % 62)) & 1;
        k.push(!k[i - 4] ^ tmp ^ bit ^ 3);
    }
    k
}

fn simon_encrypt(pt: [u64; 2], key: [u64; 4]) -> [u64; 2] {
    let k = simon_key_expand(key);
    let [mut x, mut y] = pt;
    for ki in k.iter().take(72) {
        let tmp = y;
        let f = y.rotate_left(1) & y.rotate_left(8);
        y = x ^ f ^ y.rotate_left(2) ^ ki;
        x = tmp;
    }
    [x, y]
}

// ------------------------------------------------------------------ SPECK-64
fn le64(buf: &[u8], off: usize) -> u64 {
    u64::from_le_bytes(buf[off..off + 8].try_into().unwrap())
}

fn speck_key_schedule(key: &[u8]) -> Vec<u64> {
    let mut ks = vec![le64(key, 0)];
    let mut ls: Vec<u64> = (1..key.len() / 8).map(|i| le64(key, i * 8)).collect();
    for x in 0..33usize {
        let rs_x = ls[x].rotate_right(8);
        let new_x = (x as u64) ^ rs_x.wrapping_add(ks[x]);
        let ls_y = ks[x].rotate_left(3);
        ls.push(new_x);
        ks.push(new_x ^ ls_y);
    }
    ks
}

fn speck_encrypt(key: &[u8], plaintext: &[u8]) -> Vec<u8> {
    let pad = 16 - plaintext.len() % 16;
    let mut padded = plaintext.to_vec();
    padded.extend(std::iter::repeat(pad as u8).take(pad));
    let ks = speck_key_schedule(key);
    let mut out = Vec::with_capacity(padded.len());
    for chunk in padded.chunks(16) {
        let mut y = le64(chunk, 0);
        let mut x = le64(chunk, 8);
        for k in &ks {
            x = k ^ x.rotate_right(8).wrapping_add(y);
            y = x ^ y.rotate_left(3);
        }
        out.extend_from_slice(&y.to_le_bytes());
        out.extend_from_slice(&x.to_le_bytes());
    }
    out
}

// ------------------------------------------------------------------ Protobuf（只用 varint 和定长字段）
#[derive(Default)]
struct Pb(Vec<u8>);

impl Pb {
    fn raw_varint(&mut self, mut v: u64) {
        while v >= 0x80 {
            self.0.push((v & 0x7F) as u8 | 0x80);
            v >>= 7;
        }
        self.0.push(v as u8);
    }

    fn varint(&mut self, field: u64, v: u64) {
        self.raw_varint(field * 8);
        self.raw_varint(v);
    }

    fn bytes(&mut self, field: u64, data: &[u8]) {
        self.raw_varint(field * 8 + 2);
        self.raw_varint(data.len() as u64);
        self.0.extend_from_slice(data);
    }

    fn string(&mut self, field: u64, s: &str) {
        self.bytes(field, s.as_bytes());
    }

    fn message(&mut self, field: u64, build: impl FnOnce(&mut Pb)) {
        let mut sub = Pb::default();
        build(&mut sub);
        self.bytes(field, &sub.0);
    }
}

// ------------------------------------------------------------------ 签名
fn get_argus(query: &str, xss_stub: &str, timestamp: u64, rand_int: u32) -> String {
    let mut device_id = "";
    let mut version_name = "";
    for p in query.split('&') {
        if !p.contains('=') {
            continue;
        }
        let mut it = p.split('=');
        match (it.next(), it.next()) {
            (Some("device_id"), Some(v)) => device_id = v,
            (Some("version_name"), Some(v)) => version_name = v,
            _ => {}
        }
    }

    let body_hash = if xss_stub.is_empty() {
        sm3_prefix6(&[0u8; 16])
    } else {
        let head: String = xss_stub.chars().take(32).collect();
        sm3_prefix6(&hex::decode(head).unwrap_or_default())
    };
    let query_hash = if query.is_empty() {
        sm3_prefix6(&[0u8; 16])
    } else {
        sm3_prefix6(query.as_bytes())
    };

    let mut pb = Pb::default();
    pb.varint(1, 0x20200929 * 2);
    pb.varint(2, 2);
    pb.varint(3, rand_int as u64);
    pb.string(4, AID);
    pb.string(5, device_id);
    pb.string(6, LICENSE_ID);
    pb.string(7, version_name);
    pb.string(8, SDK_VERSION);
    pb.varint(9, SDK_VERSION_INT);
    pb.bytes(10, &[0u8; 8]);
    pb.varint(11, 0);
    pb.varint(12, timestamp * 2);
    pb.bytes(13, &body_hash);
    pb.bytes(14, &query_hash);
    pb.message(15, |s| {
        s.varint(1, 1);
        s.varint(2, 1);
        s.varint(3, 1);
        s.varint(7, 3348294860);
    });
    pb.string(16, "");
    pb.string(20, "none");
    pb.varint(21, CALL_TYPE);
    pb.message(23, |s| {
        s.string(1, "NX551J");
        s.varint(2, 8196);
        s.varint(4, 2162219008);
    });
    pb.varint(25, 2);

    let mut protobuf = pb.0;
    let pb_pad = 16 - protobuf.len() % 16;
    protobuf.extend(std::iter::repeat(pb_pad as u8).take(pb_pad));

    let mut seed = SIGN_KEY.to_vec();
    seed.extend_from_slice(&LOW_RAND);
    seed.extend_from_slice(&HIGH_RAND);
    seed.extend_from_slice(&SIGN_KEY);
    let digest = sm3(&seed);
    let key = [
        le64(&digest, 0),
        le64(&digest, 8),
        le64(&digest, 16),
        le64(&digest, 24),
    ];

    let mut data = XOR_PREFIX.to_vec();
    for chunk in protobuf.chunks(16) {
        let [lo, hi] = simon_encrypt([le64(chunk, 0), le64(chunk, 8)], key);
        data.extend_from_slice(&lo.to_le_bytes());
        data.extend_from_slice(&hi.to_le_bytes());
    }
    for i in 8..data.len() {
        data[i] ^= data[i % 8];
    }
    data.reverse();

    let mut plaintext = ARGUS_HEADER.to_vec();
    plaintext.extend_from_slice(&data);
    plaintext.extend_from_slice(&HIGH_RAND);
    let ciphertext = aes_cbc_encrypt(&md5(&SIGN_KEY[..16]), &md5(&SIGN_KEY[16..]), &plaintext)
        .expect("固定长度的 key/iv 不会出错");
    let mut out = LOW_RAND.to_vec();
    out.extend_from_slice(&ciphertext);
    base64_encode(&out)
}

fn get_ladon(timestamp: u64, rand4: [u8; 4]) -> String {
    let plaintext = format!("{timestamp}-{LICENSE_ID}-{AID}");
    let mut seed = rand4.to_vec();
    seed.extend_from_slice(AID.as_bytes());
    let key = md5_hex(&seed);
    let mut out = rand4.to_vec();
    out.extend(speck_encrypt(key.as_bytes(), plaintext.as_bytes()));
    base64_encode(&out)
}

pub fn base64_encode(data: &[u8]) -> String {
    use base64::Engine;
    base64::engine::general_purpose::STANDARD.encode(data)
}

pub fn base64_decode(s: &str) -> R<Vec<u8>> {
    use base64::Engine;
    base64::engine::general_purpose::STANDARD
        .decode(s.trim())
        .map_err(|e| format!("base64 解码失败：{e}"))
}

/// 对一个请求签名，返回要附加的请求头。body 非空时一并参与 X-SS-STUB
pub fn sign_request_with(
    url: &str,
    body: Option<&[u8]>,
    now_ms: u64,
    rand_int: u32,
    rand4: [u8; 4],
) -> Vec<(String, String)> {
    let raw_query = url::Url::parse(url)
        .ok()
        .and_then(|u| u.query().map(str::to_string))
        .unwrap_or_default();
    let xss_stub = body.map(md5_hex).unwrap_or_default();
    let ts = now_ms / 1000;
    let mut headers = vec![
        (
            "x-argus".to_string(),
            get_argus(&raw_query, &xss_stub, ts, rand_int),
        ),
        ("x-ladon".to_string(), get_ladon(ts, rand4)),
        ("x-khronos".to_string(), ts.to_string()),
        ("x-ss-req-ticket".to_string(), now_ms.to_string()),
    ];
    if body.is_some() {
        headers.push(("X-SS-STUB".to_string(), xss_stub));
    }
    headers
}

pub fn sign_request(url: &str, body: Option<&[u8]>) -> Vec<(String, String)> {
    let mut rng = rand::thread_rng();
    let now_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);
    sign_request_with(url, body, now_ms, rng.gen_range(0..0x7FFFFFFF), rng.gen())
}

// ------------------------------------------------------------------ TTEncrypt（设备注册请求体）
pub fn tt_encrypt(data: &[u8]) -> R<Vec<u8>> {
    use std::io::Write;
    let random: [u8; 32] = rand::thread_rng().gen();
    let mut seed = sha512(&random).to_vec();
    seed.extend(base64_decode(FIXED_STRING_B64)?);
    let hash = sha512(&seed);
    let (key, iv) = (&hash[..16], &hash[16..32]);

    let mut gz = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::default());
    gz.write_all(data).map_err(|e| e.to_string())?;
    let compressed = gz.finish().map_err(|e| e.to_string())?;

    let mut plain = sha512(&compressed).to_vec();
    plain.extend_from_slice(&compressed);
    let encrypted = aes_cbc_encrypt(key, iv, &plain)?;

    let mut out = vec![116, 99, 5, 16, 0, 0];
    out.extend_from_slice(&random);
    out.extend(encrypted);
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sm3_标准向量() {
        assert_eq!(
            hex::encode(sm3(b"abc")),
            "66c7f0f462eeedd9d1f2d46bdc10e4e24167c4875cf2f7a2297da02b8f4ba8e0"
        );
    }

    /// 期望值由原 Node 实现在同样的固定随机数和时间下算出
    #[test]
    fn 签名与_node_实现逐字一致() {
        let url = "https://reading.snssdk.com/reading/crypt/registerkey?iid=1&device_id=7000000000000000001&version_name=7.0.1.32&aid=1967";
        let h = sign_request_with(
            url,
            Some(b"{\"content\":\"abc\"}"),
            1700000000123,
            123456789,
            [1, 2, 3, 4],
        );
        let get = |k: &str| {
            h.iter()
                .find(|(n, _)| n == k)
                .map(|(_, v)| v.clone())
                .unwrap()
        };
        assert_eq!(get("x-argus"), include_str!("../testdata/argus.txt").trim());
        assert_eq!(get("x-ladon"), include_str!("../testdata/ladon.txt").trim());
        assert_eq!(get("X-SS-STUB"), md5_hex(b"{\"content\":\"abc\"}"));
    }
}
