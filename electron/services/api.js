const https = require('https');
const crypto = require('crypto');

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

exports.getBookDetail = async function getBookDetail(bookId) {
  try {
    const html = await webRequest(`/page/${bookId}`);
    const state = extractState(html);
    if (!state?.page) return null;
    return normalizeWebBook(state.page);
  } catch (err) {
    console.error('BookDetail error:', err.message);
    return null;
  }
};

exports.getChapters = async function getChapters(bookId) {
  try {
    const html = await webRequest(`/page/${bookId}`);
    const state = extractState(html);
    if (!state?.page) return [];

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

exports.getCategories = async function getCategories() {
  return [
    { id: 'male', name: '男频', children: [
      { id: '7', name: '玄幻' }, { id: '1', name: '都市' },
      { id: '11', name: '科幻' }, { id: '5', name: '历史' },
      { id: '8', name: '仙侠' }, { id: '3', name: '游戏' },
    ]},
    { id: 'female', name: '女频', children: [
      { id: '12', name: '现言' }, { id: '13', name: '古言' },
      { id: '14', name: '幻想' }, { id: '15', name: '悬疑' },
    ]},
  ];
};

exports.getRanking = async function getRanking(categoryId = '0', page = 0) {
  try {
    const html = await webRequest('/');
    const state = extractState(html);
    if (!state?.home) return { books: [], total: 0, hasMore: false };
    const home = state.home;

    let list;
    switch (categoryId) {
      case '0': // 推荐
        list = [...(home.readRankList || []), ...(home.boyList || []), ...(home.girlList || [])];
        break;
      case '7': case '8': case '11': case '5': case '1': case '3': // 男频分类
        list = [...(home.boyList || []), ...(home.readRankList || [])];
        break;
      case '12': case '13': case '14': case '15': // 女频分类
        list = [...(home.girlList || []), ...(home.readRankList || [])];
        break;
      default:
        list = [...(home.topRankList || []), ...(home.readRankList || [])];
    }

    const books = list.map(normalizeWebBook).filter(Boolean);
    const unique = [...new Map(books.map(b => [b.id, b])).values()];
    return { books: unique, total: unique.length, hasMore: false };
  } catch (err) {
    console.error('Ranking error:', err.message);
    return { books: [], total: 0, hasMore: false };
  }
};
