const https = require('https');
const crypto = require('crypto');
const { decodeText } = require('./fontdecode');

const WEB_HOST = 'fanqienovel.com';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

function webRequest(path, { withHeaders = false } = {}) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: WEB_HOST,
      path: encodeURI(path),
      method: 'GET',
      headers: {
        'User-Agent': UA,
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'zh-CN,zh;q=0.9',
        'Cookie': `novel_web_id=${crypto.randomBytes(8).readBigUInt64BE()}`,
      },
      timeout: 15000,
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        if (withHeaders) {
          resolve({ body: data, headers: res.headers });
        } else {
          resolve(data);
        }
      });
    });

    req.on('error', reject);
    req.setTimeout(15000, () => { req.destroy(); reject(new Error('timeout')); });
    req.end();
  });
}

function extractState(html) {
  const marker = 'window.__INITIAL_STATE__=';
  const idx = html.indexOf(marker);
  if (idx < 0) return null;
  const start = idx + marker.length;
  let depth = 0;
  let end = start;
  for (let i = start; i < html.length; i++) {
    if (html[i] === '{') depth++;
    else if (html[i] === '}') depth--;
    if (depth === 0) { end = i + 1; break; }
  }
  try {
    const raw = html.slice(start, end)
      .replace(/\bundefined\b/g, 'null');
    return JSON.parse(raw);
  } catch { return null; }
}

function normalizeWebBook(raw) {
  if (!raw) return null;
  return {
    id: String(raw.bookId || raw.book_id || ''),
    title: raw.bookName || raw.book_name || '',
    author: raw.author || '',
    cover: raw.thumbUri || raw.thumbUrl || raw.thumb_url || '',
    description: raw.abstract || '',
    category: raw.category || '',
    wordCount: raw.wordNumber || raw.word_number || raw.word_count || 0,
    status: raw.creationStatus === 0 || raw.creation_status === '0' ? '连载中' : '已完结',
    latestChapter: raw.lastChapterTitle || raw.last_chapter_title || '',
  };
}

function cleanContent(html) {
  if (!html) return '';
  return html
    .replace(/<img[^>]*>/g, '')
    .replace(/<\/?(p|div|br|header|footer|section)[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

exports.search = async function search(query, page = 0) {
  try {
    const html = await webRequest(`/search/${query}`);
    const state = extractState(html);
    if (!state) return { books: [], total: 0, hasMore: false };

    const list = state.search?.searchBookList || [];
    if (list.length > 0) {
      const books = list.map(normalizeWebBook).filter(Boolean);
      return { books, total: state.search?.total || books.length, hasMore: books.length >= 10 };
    }

    // 搜索页面可能没有 SSR 数据，从首页推荐里搜索
    const homeHtml = await webRequest('/');
    const homeState = extractState(homeHtml);
    if (!homeState) return { books: [], total: 0, hasMore: false };
    const home = homeState.home || {};
    const allBooks = [
      ...(home.boyList || []),
      ...(home.girlList || []),
      ...(home.readRankList || []),
      ...(home.newRankList || []),
      ...(home.topRankList || []),
      ...(home.weekList || []),
    ];
    const q = query.toLowerCase();
    const matched = allBooks
      .filter(b => {
        const name = (b.bookName || b.book_name || '').toLowerCase();
        const author = (b.author || '').toLowerCase();
        return name.includes(q) || author.includes(q);
      })
      .map(normalizeWebBook)
      .filter(Boolean);
    const unique = [...new Map(matched.map(b => [b.id, b])).values()];
    return { books: unique, total: unique.length, hasMore: false };
  } catch (err) {
    console.error('Search error:', err.message);
    return { books: [], total: 0, hasMore: false };
  }
};

// 书页 HTML 很大，详情页要同时取详情和目录、进阅读页又取一次目录；同一本书 10 分钟内共用一次请求
const PAGE_TTL = 10 * 60 * 1000;
const pageCache = new Map();

function getPageState(bookId) {
  const hit = pageCache.get(bookId);
  if (hit && Date.now() - hit.at < PAGE_TTL) return hit.task;
  for (const [id, e] of pageCache) if (Date.now() - e.at >= PAGE_TTL) pageCache.delete(id);
  const task = webRequest(`/page/${bookId}`).then((html) => {
    const state = extractState(html);
    if (!state?.page) throw new Error('书页解析失败');
    return state;
  });
  // 失败的不留，下次重新请求
  task.catch(() => pageCache.delete(bookId));
  pageCache.set(bookId, { task, at: Date.now() });
  return task;
}

exports.getBookDetail = async function getBookDetail(bookId) {
  try {
    const state = await getPageState(bookId);
    return normalizeWebBook(state.page);
  } catch (err) {
    console.error('BookDetail error:', err.message);
    return null;
  }
};

exports.getChapters = async function getChapters(bookId) {
  try {
    const state = await getPageState(bookId);
    const page = state.page;
    const volumes = page.chapterListWithVolume || [];
    const chapters = [];
    let index = 0;
    for (const vol of volumes) {
      const items = vol || [];
      for (const ch of items) {
        if (ch && ch.itemId) {
          chapters.push({
            id: String(ch.itemId),
            title: ch.title || `第${index + 1}章`,
            bookId,
            index,
            isVip: !!ch.needPay,
          });
          index++;
        }
      }
    }

    if (chapters.length === 0 && page.itemIds) {
      for (let i = 0; i < page.itemIds.length; i++) {
        chapters.push({
          id: String(page.itemIds[i]),
          title: `第${i + 1}章`,
          bookId,
          index: i,
          isVip: false,
        });
      }
    }

    return chapters;
  } catch (err) {
    console.error('Chapters error:', err.message);
    return [];
  }
};

function fetchBuffer(url) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : require('http');
    mod.get(url, { headers: { 'User-Agent': UA }, timeout: 15000 }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchBuffer(res.headers.location).then(resolve, reject);
      }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
    }).on('error', reject);
  });
}

async function inlineFontCss(css) {
  if (!css) return '';
  const urlRe = /url\(["']?(https?:\/\/[^"')]+\.(?:woff2?|otf|ttf))["']?\)/g;
  const matches = [...css.matchAll(urlRe)];
  if (matches.length === 0) return css;

  let result = css;
  for (const m of matches) {
    try {
      const buf = await fetchBuffer(m[1]);
      const ext = m[1].match(/\.(woff2|woff|otf|ttf)$/)?.[1] || 'woff2';
      const mime = ext === 'otf' ? 'font/otf' : ext === 'ttf' ? 'font/ttf' : `font/${ext}`;
      const dataUrl = `data:${mime};base64,${buf.toString('base64')}`;
      result = result.replace(m[0], `url("${dataUrl}")`);
    } catch (e) {
      console.error('Font fetch failed:', e.message);
    }
  }
  return result;
}

exports.getChapterContent = async function getChapterContent(itemId) {
  try {
    const { body, headers } = await webRequest(`/reader/${itemId}`, { withHeaders: true });
    const state = extractState(body);
    if (!state?.reader?.chapterData) return { content: '', fontCss: '' };

    const content = cleanContent(state.reader.chapterData.content || '');
    const rawCss = headers['x-tt-zhal'] || state.common?.css || '';
    const fontCss = await inlineFontCss(rawCss);

    return { content, fontCss };
  } catch (err) {
    console.error('ChapterContent error:', err.message);
    return { content: '', fontCss: '' };
  }
};

// 排行榜分类（取自 fanqienovel.com/rank 的 rankCategoryTypeList）
const RANK_CATEGORIES = {
  male: [
    ['1141', '西方奇幻'], ['1140', '东方仙侠'], ['8', '科幻末世'], ['261', '都市日常'],
    ['124', '都市修真'], ['1014', '都市高武'], ['273', '历史古代'], ['27', '战神赘婿'],
    ['263', '都市种田'], ['258', '传统玄幻'], ['272', '历史脑洞'], ['539', '悬疑脑洞'],
    ['262', '都市脑洞'], ['257', '玄幻脑洞'], ['751', '悬疑灵异'], ['504', '抗战谍战'],
    ['746', '游戏体育'], ['718', '动漫衍生'], ['1016', '男频衍生'],
  ],
  female: [
    ['1139', '古风世情'], ['8', '科幻末世'], ['746', '游戏体育'], ['1015', '女频衍生'],
    ['248', '玄幻言情'], ['23', '种田'], ['79', '年代'], ['267', '现言脑洞'],
    ['246', '宫斗宅斗'], ['539', '悬疑脑洞'], ['253', '古言脑洞'], ['24', '快穿'],
    ['749', '青春甜宠'], ['745', '星光璀璨'], ['747', '女频悬疑'], ['750', '职场婚恋'],
    ['748', '豪门总裁'], ['1017', '民国言情'],
  ],
};

// 分组 id 即性别参数（1 男频 / 0 女频）；同一分类号在男女频下是不同的榜单
exports.getCategories = async function getCategories() {
  return [
    { id: '1', name: '男频', children: RANK_CATEGORIES.male.map(([id, name]) => ({ id, name })) },
    { id: '0', name: '女频', children: RANK_CATEGORIES.female.map(([id, name]) => ({ id, name })) },
  ];
};

const RANK_PAGE_SIZE = 30;

// rankId 与官网排行页路径一致：性别_榜单_分类，如 "1_2_1141"（榜单 2 阅读榜 / 1 新书榜）；
// "top" 是官网首页的番茄巅峰榜（综合得分排行，共 30 本、不分页，文字是明文）
exports.getRanking = async function getRanking(rankId = '1_2_1141', page = 0) {
  try {
    if (rankId === 'top') {
      const json = await webRequest('/api/author/misc/top_book_list/v1/?limit=200&offset=0');
      const books = (JSON.parse(json).book_list || []).map(normalizeWebBook).filter(Boolean);
      return { books, total: books.length, hasMore: false };
    }
    const [gender, mold, cid] = String(rankId).split('_');
    const offset = page * RANK_PAGE_SIZE;
    const json = await webRequest(`/api/rank/category/list?app_id=2503&rank_list_type=3&offset=${offset}&limit=${RANK_PAGE_SIZE}&category_id=${cid}&rank_version=&gender=${gender}&rankMold=${mold}`);
    const data = JSON.parse(json).data || {};
    const list = data.book_list || [];

    const books = list.map((raw) => normalizeWebBook({
      ...raw,
      bookName: decodeText(raw.bookName),
      author: decodeText(raw.author),
      abstract: decodeText(raw.abstract),
      lastChapterTitle: decodeText(raw.lastChapterTitle),
    })).filter(Boolean);
    const total = data.total_num || 0;
    return { books, total, hasMore: offset + list.length < total };
  } catch (err) {
    console.error('Ranking error:', err.message);
    return { books: [], total: 0, hasMore: false };
  }
};

// 官网首页的推荐模块（服务端渲染，文字是明文）
const RECOMMEND_SECTIONS = [
  ['weekList', '本周推荐'],
  ['editorList', '编辑推荐'],
  ['boyList', '男频精选'],
  ['girlList', '女频精选'],
];

exports.getRecommend = async function getRecommend() {
  try {
    const state = extractState(await webRequest('/'));
    const home = state?.home || {};
    return RECOMMEND_SECTIONS
      .map(([key, title]) => ({ title, books: (home[key] || []).map(normalizeWebBook).filter(Boolean) }))
      .filter((s) => s.books.length > 0);
  } catch (err) {
    console.error('Recommend error:', err.message);
    return [];
  }
};

// =========================================================================
// 段评表情：番茄没有公开的表情接口，借用抖音网页版的表情图（同属字节，名称大多一致）
// =========================================================================
// 番茄有、抖音叫法不同的表情
const EMOJI_ALIASES = {
  '[吃瓜]': '[吃瓜群众]',
  '[酷]': '[酷拽]',
  '[哭]': '[流泪]',
  '[笑]': '[微笑]',
  '[爱慕]': '[色]',
  '[盯]': '[看]',
};
let emojiTask = null;

/** { '[偷笑]': 图片地址 }；拉取失败返回空表，下次再试 */
exports.getEmojis = function getEmojis() {
  if (!emojiTask) {
    emojiTask = fetchBuffer('https://www.douyin.com/aweme/v1/web/emoji/list')
      .then((buf) => {
        const map = {};
        for (const e of JSON.parse(buf.toString('utf-8')).emoji_list || []) {
          const url = ((e.emoji_url || {}).url_list || [])[0];
          if (e.display_name && url) map[e.display_name] = url;
        }
        for (const [name, target] of Object.entries(EMOJI_ALIASES)) {
          if (!map[name] && map[target]) map[name] = map[target];
        }
        if (Object.keys(map).length === 0) throw new Error('表情列表为空');
        return map;
      })
      .catch((err) => {
        console.error('Emoji error:', err.message);
        emojiTask = null;
        return {};
      });
  }
  return emojiTask;
};
