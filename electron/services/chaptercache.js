const fs = require('fs');
const path = require('path');
const { app } = require('electron');
const { parseChapterXhtml } = require('./appapi');

// 正文缓存：内存 + 磁盘。App 接口两次请求之间要隔 6 秒，所以没缓存的章节顺带把后面几章一起取回来
const DIR = path.join(app.getPath('userData'), 'cache', 'chapters');
/** 一次请求顺带取后面几章（接口单次最多 30 章） */
const PREFETCH = 4;
const MEM_SIZE = 50;
/** 磁盘上最多留多少章，超出删最旧的 */
const DISK_SIZE = 2000;

/** 章节 id → 所属书和全书章节 id 列表，打开目录时登记，预取靠它找后面的章 */
const books = new Map();
const mem = new Map();
const inflight = new Map();

const file = (id) => path.join(DIR, `${id}.json`);

function remember(id, data) {
  mem.delete(id);
  mem.set(id, data);
  while (mem.size > MEM_SIZE) mem.delete(mem.keys().next().value);
}

function readCached(id) {
  const hit = mem.get(id);
  if (hit) {
    remember(id, hit);
    return hit;
  }
  try {
    const data = JSON.parse(fs.readFileSync(file(id), 'utf-8'));
    remember(id, data);
    return data;
  } catch {
    return null;
  }
}

function writeCached(id, data) {
  remember(id, data);
  fs.promises.mkdir(DIR, { recursive: true })
    .then(() => fs.promises.writeFile(file(id), JSON.stringify(data)))
    .catch((err) => console.warn('正文缓存写盘失败:', err.message));
}

function toData(xhtml) {
  const { paragraphs, paraIdx } = parseChapterXhtml(xhtml);
  return paragraphs.length ? { content: paragraphs.join('\n'), paraIdx } : null;
}

/** 登记一本书的章节顺序 */
exports.registerBook = function registerBook(bookId, chapters) {
  const ids = chapters.map((c) => c.id);
  for (const id of ids) books.set(id, { bookId, ids });
};

/** 取一章正文 { content, paraIdx }；没缓存时连同后面几章一次取回 */
exports.getChapter = function getChapter(appApi, itemId) {
  const id = String(itemId);
  const cached = readCached(id);
  if (cached) return Promise.resolve(cached);
  if (inflight.has(id)) return inflight.get(id);

  const book = books.get(id);
  const batch = [id];
  if (book) {
    const i = book.ids.indexOf(id);
    for (const next of book.ids.slice(i + 1, i + 1 + PREFETCH)) {
      if (!mem.has(next) && !inflight.has(next) && !fs.existsSync(file(next))) batch.push(next);
    }
  }
  const bookId = book?.bookId || '';

  // 预取的章只试一轮，拿不到（如未购买）不拖慢当前章
  const task = appApi.fetchChapters(batch, bookId, { maxRounds: 1 }).then((got) => {
    const out = {};
    for (const [k, xhtml] of Object.entries(got)) {
      const data = toData(xhtml);
      if (data) {
        writeCached(k, data);
        out[k] = data;
      }
    }
    return out;
  });
  for (const k of batch) {
    const p = task.then(async (out) => {
      if (out[k]) return out[k];
      if (k !== id) throw new Error('预取未拿到');
      // 当前章第一轮没拿到，补足原来的三轮重试
      const data = toData((await appApi.fetchChapters([k], bookId, { maxRounds: 2 }))[k] || '');
      if (!data) throw new Error('该章节未能获取正文');
      writeCached(k, data);
      return data;
    }).finally(() => inflight.delete(k));
    if (k !== id) p.catch(() => {});
    inflight.set(k, p);
  }
  return inflight.get(id);
};

/** 启动时清理：超出上限就删最旧的 */
exports.prune = async function prune() {
  try {
    const names = await fs.promises.readdir(DIR);
    if (names.length <= DISK_SIZE) return;
    const stats = await Promise.all(names.map(async (n) => ({ n, t: (await fs.promises.stat(path.join(DIR, n))).mtimeMs })));
    stats.sort((a, b) => a.t - b.t);
    await Promise.all(stats.slice(0, names.length - DISK_SIZE).map(({ n }) => fs.promises.unlink(path.join(DIR, n))));
  } catch {}
};
