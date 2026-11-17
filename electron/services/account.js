/**
 * 番茄账号：扫码登录（用番茄小说 App 扫码）+ 云书架 / 阅读进度同步。
 *
 * 登录走字节 passport 网页扫码流程，拿到 sessionid 等 Cookie；
 * 书架与进度走官方 reading/bookapi 接口（fanqienovel.com 域，只认 Cookie，不需要签名）。
 * Cookie 用 safeStorage 加密后存在 userData/data/account.bin。
 */

'use strict';

const { app, safeStorage } = require('electron');
const fs = require('fs');
const path = require('path');

const BASE = 'https://fanqienovel.com';
const LOGIN_PAGE = `${BASE}/main/writer/login`;
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const PASSPORT_PARAMS = {
  passport_jssdk_version: '3.0.16',
  passport_jssdk_type: 'normal',
  aid: '2503',
  language: 'zh',
  account_sdk_source: 'web',
};
const SHELF_PARAMS = 'aid=1967&iid=0&version_code=57700&update_version_code=57700';
const SESSION_KEYS = ['sessionid', 'sessionid_ss', 'sid_tt'];

const dataFile = () => path.join(app.getPath('userData'), 'data', 'account.bin');

let jar = {};
let user = null;
let loaded = false;

// ---------------------------------------------------------------- 持久化
function load() {
  if (loaded) return;
  loaded = true;
  try {
    const raw = fs.readFileSync(dataFile());
    const text = safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(raw) : raw.toString('utf-8');
    const saved = JSON.parse(text);
    jar = saved.jar || {};
    user = saved.user || null;
  } catch {
    jar = {};
    user = null;
  }
}

function persist() {
  const file = dataFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const text = JSON.stringify({ jar, user });
  fs.writeFileSync(file, safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(text) : text);
}

// ---------------------------------------------------------------- HTTP
function mergeCookies(res) {
  for (const line of res.headers.getSetCookie()) {
    const [pair, ...attrs] = line.split(';');
    const i = pair.indexOf('=');
    if (i < 0) continue;
    const name = pair.slice(0, i).trim();
    const value = pair.slice(i + 1).trim();
    const expired = attrs.some((a) => /^\s*max-age=0\s*$/i.test(a));
    if (!value || expired) delete jar[name];
    else jar[name] = value;
  }
}

const cookieHeader = () => Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');

async function request(url, { method = 'GET', body, redirect = 'follow', referer = `${BASE}/` } = {}) {
  const headers = {
    'User-Agent': UA,
    Accept: 'application/json, text/plain, */*',
    'Accept-Language': 'zh-CN,zh;q=0.9',
    Referer: referer,
    Origin: BASE,
  };
  const cookie = cookieHeader();
  if (cookie) headers.Cookie = cookie;
  if (jar.passport_csrf_token) headers['x-tt-passport-csrf-token'] = jar.passport_csrf_token;
  if (body !== undefined) headers['Content-Type'] = 'application/json;charset=UTF-8';
  const res = await fetch(url, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect,
    signal: AbortSignal.timeout(15000),
  });
  mergeCookies(res);
  return res;
}

async function requestJSON(url, opts) {
  const res = await request(url, opts);
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`接口返回非 JSON（HTTP ${res.status}）`);
  }
}

const passportQuery = (extra) => new URLSearchParams({ ...PASSPORT_PARAMS, ...extra }).toString();

function hasSession() {
  return SESSION_KEYS.some((k) => !!jar[k]);
}

// ---------------------------------------------------------------- 登录
exports.isLoggedIn = function () {
  load();
  return hasSession();
};

/** App 接口也认网页登录的 Cookie（段评点赞、发评论用）；未登录返回空串 */
exports.getCookieHeader = function () {
  load();
  return hasSession() ? cookieHeader() : '';
};

/** 申请登录二维码：返回 { token, image(dataURL), expireTime(秒) } */
exports.getQrcode = async function () {
  load();
  jar = {};
  user = null;
  await request(LOGIN_PAGE, { referer: LOGIN_PAGE });
  const json = await requestJSON(
    `${BASE}/passport/web/get_qrcode/?${passportQuery({ need_logo: 'true', next: `${BASE}/` })}`,
    { referer: LOGIN_PAGE },
  );
  const d = json.data || {};
  if (json.message !== 'success' || !d.token || !d.qrcode) {
    throw new Error(`获取二维码失败：${d.description || json.message || '未知错误'}`);
  }
  return { token: d.token, image: `data:image/png;base64,${d.qrcode}`, expireTime: Number(d.expire_time) || 0 };
};

/** 手动跟随重定向，保留每一跳的 Set-Cookie（sessionid 可能在任意一跳下发） */
async function followRedirects(url) {
  for (let i = 0; i < 6 && url; i++) {
    const res = await request(url, { redirect: 'manual', referer: LOGIN_PAGE });
    if (hasSession()) return;
    const location = res.headers.get('location');
    url = location ? new URL(location, url).toString() : '';
  }
}

/**
 * 轮询扫码状态：
 *   new 等待扫码 / scanned 已扫码待确认 / expired 已过期 / success 登录成功（附带 user）
 */
exports.checkQrcode = async function (token) {
  load();
  const res = await request(
    `${BASE}/passport/web/check_qrconnect/?${passportQuery({ token, next: `${BASE}/` })}`,
    { redirect: 'manual', referer: LOGIN_PAGE },
  );
  let data = {};
  try { data = (await res.json()).data || {}; } catch { /* 302 时没有 body */ }

  if (!hasSession() && (data.status === 'confirmed' || data.status === 'success') && data.redirect_url) {
    await followRedirects(data.redirect_url);
  }
  if (hasSession()) {
    persist();
    return { status: 'success', user: await exports.getUser() };
  }
  if (data.status === 'expired') return { status: 'expired' };
  if (data.status === 'scanned') return { status: 'scanned' };
  if (data.error_code && data.status !== 'new') {
    return { status: 'error', message: data.description || `登录失败（${data.error_code}）` };
  }
  return { status: 'new' };
};

/** 当前登录用户：{ id, name, avatar }，未登录返回 null */
exports.getUser = async function () {
  load();
  if (!hasSession()) return null;
  try {
    // 番茄自己的资料（App 里的昵称和头像），passport 账号信息里只有字节默认昵称
    const json = await requestJSON(`${BASE}/api/user/info/v2`);
    const d = json.data || {};
    if (Number(json.code) === 0 && d.id) {
      user = {
        id: String(d.id),
        name: d.name || '番茄用户',
        avatar: d.avatar || '',
        isVip: !!d.isVip,
      };
      persist();
    } else if (/登录/.test(json.message || '')) {
      // 登录态已失效
      await exports.logout();
      return null;
    }
  } catch {
    // 网络失败时沿用本地缓存的用户信息
  }
  return user;
};

exports.logout = async function () {
  load();
  if (hasSession()) {
    try { await request(`${BASE}/passport/web/logout/?${passportQuery()}`); } catch { /* 忽略 */ }
  }
  jar = {};
  user = null;
  try { fs.unlinkSync(dataFile()); } catch { /* 文件不存在 */ }
};

// ---------------------------------------------------------------- 云书架
function ensureLogin() {
  load();
  if (!hasSession()) throw new Error('未登录番茄账号');
}

function checkCode(json, action) {
  if (Number(json.code) === 0) return json;
  // 101108 无用户信息 / 101119 获取书架失败（未登录）
  if ([101108, 101119].includes(Number(json.code))) {
    throw new Error('番茄登录已失效，请重新登录');
  }
  throw new Error(`${action}失败：${json.message || json.code}`);
}

function normalizeCover(url) {
  // 带签名的封面次日过期，换成无签名 CDN 地址
  const m = /(novel-(?:pic|static)\/[^~?#]+)/.exec(url || '');
  return m ? `https://p6-novel.byteimg.com/${m[1]}~tplv-shrink:320:0.image` : url || '';
}

/**
 * 拉取云书架（按加入顺序），附带每本书的云端阅读进度。
 * 返回 [{ book, lastReadChapterId, lastReadChapterTitle, progress, addedAt, updatedAt }]
 */
exports.getCloudShelf = async function () {
  ensureLogin();
  const info = checkCode(
    await requestJSON(`${BASE}/reading/bookapi/bookshelf/info/v:version/?${SHELF_PARAMS}`),
    '获取书架',
  );
  const d = info.data || {};
  const shelf = (Array.isArray(d) ? d : d.book_shelf_info || [])
    .filter((b) => b.book_id && String(b.book_type ?? 0) === '0');
  if (!shelf.length) return [];

  const progressJson = await requestJSON(`${BASE}/api/reader/book/progress`).catch(() => ({}));
  const progressMap = new Map(
    (Array.isArray(progressJson.data) ? progressJson.data : [])
      .map((p) => [String(p.book_id), p]),
  );

  const details = new Map();
  // multidetail 一次最多取 50 本
  for (let i = 0; i < shelf.length; i += 50) {
    const books = shelf.slice(i, i + 50).map((b) => ({
      book_id: String(b.book_id),
      item_id: String(progressMap.get(String(b.book_id))?.item_id || '0'),
    }));
    const json = await requestJSON(`${BASE}/api/bookshelf/multidetail`, { method: 'POST', body: { books } });
    for (const item of json.data?.detail_list || []) details.set(String(item.book_id), item);
  }

  return shelf.map((s) => {
    const id = String(s.book_id);
    const item = details.get(id) || {};
    const progress = progressMap.get(id);
    const addedMs = Number(s.add_shelf_time) * 1000 || Date.now();
    const readMs = Number(progress?.read_timestamp) * 1000 || addedMs;
    const itemId = progress?.item_id && String(progress.item_id) !== '0' ? String(progress.item_id) : '';
    return {
      book: {
        id,
        title: item.book_name || '',
        author: item.author || '',
        cover: normalizeCover(item.thumb_url),
        description: item.abstract || item.book_abstract_v2 || '',
        category: item.category || '',
        wordCount: Number(item.word_number) || 0,
        status: String(item.creation_status) === '0' ? '已完结' : '连载中',
        latestChapter: item.last_chapter_title || '',
      },
      lastReadChapterId: itemId,
      lastReadChapterTitle: itemId ? item.item_show_title || '' : '',
      // 服务端进度是万分比，本地统一用 0~1
      progress: Math.min(1, (Number(progress?.read_progress) || 0) / (Number(progress?.read_progress) > 1 ? 10000 : 1)),
      addedAt: new Date(addedMs).toISOString(),
      updatedAt: new Date(readMs).toISOString(),
    };
  });
};

exports.addToCloudShelf = async function (bookId) {
  ensureLogin();
  checkCode(await requestJSON(`${BASE}/reading/bookapi/bookshelf/add/v:version?${SHELF_PARAMS}`, {
    method: 'POST',
    body: {
      identify_data: [{ asterisked: false, modify_time: Date.now(), book_type: 0, book_id: String(bookId) }],
      add_book_source: 0,
    },
  }), '加入书架');
};

exports.removeFromCloudShelf = async function (bookId) {
  ensureLogin();
  checkCode(await requestJSON(`${BASE}/reading/bookapi/bookshelf/delete/v:version?${SHELF_PARAMS}`, {
    method: 'POST',
    body: { identify_data: [{ book_id: String(bookId) }] },
  }), '移出书架');
};

/** 上报阅读进度：itemId 为章节 id，progress 为整书进度（0~1） */
exports.updateCloudProgress = async function (bookId, itemId, index, progress) {
  ensureLogin();
  checkCode(await requestJSON(`${BASE}/api/reader/book/update_progress`, {
    method: 'POST',
    body: {
      book_id: String(bookId),
      item_id: String(itemId),
      // 服务端用万分比存整书进度
      read_progress: Math.round(progress * 10000),
      index,
      read_timestamp: String(Math.floor(Date.now() / 1000)),
      genre_type: 0,
    },
  }), '同步进度');
};
