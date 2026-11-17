const { app } = require('electron');
const fs = require('fs');
const path = require('path');

const dataDir = path.join(app.getPath('userData'), 'data');

function ensureDir() {
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
}

function readJSON(filename, fallback) {
  ensureDir();
  const file = path.join(dataDir, filename);
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch {
    return fallback;
  }
}

function writeJSON(filename, data) {
  ensureDir();
  const file = path.join(dataDir, filename);
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf-8');
}

exports.getBookshelf = function () {
  return readJSON('bookshelf.json', []);
};

exports.addToBookshelf = function (item) {
  const shelf = exports.getBookshelf();
  if (shelf.some((b) => b.book.id === item.book.id)) return shelf;
  shelf.unshift(item);
  writeJSON('bookshelf.json', shelf);
  return shelf;
};

exports.removeFromBookshelf = function (bookId) {
  let shelf = exports.getBookshelf();
  shelf = shelf.filter((b) => b.book.id !== bookId);
  writeJSON('bookshelf.json', shelf);
  return shelf;
};

exports.updateBookshelfItem = function (bookId, data) {
  const shelf = exports.getBookshelf();
  const idx = shelf.findIndex((b) => b.book.id === bookId);
  if (idx >= 0) {
    shelf[idx] = { ...shelf[idx], ...data, updatedAt: new Date().toISOString() };
    writeJSON('bookshelf.json', shelf);
  }
  return shelf;
};

exports.replaceBookshelf = function (items) {
  writeJSON('bookshelf.json', items);
  return items;
};

const defaultSettings = {
  fontSize: 18,
  lineHeight: 1.8,
  pageWidth: 720,
  theme: 'auto',
  fontFamily: 'serif',
  readingMode: 'scroll',
  paraSpacing: 0.6,
  indent: true,
};

// 书签只存本地：{ [bookId]: Bookmark[] }
exports.getBookmarks = function (bookId) {
  return readJSON('bookmarks.json', {})[bookId] || [];
};

exports.saveBookmarks = function (bookId, list) {
  const all = readJSON('bookmarks.json', {});
  if (list.length) all[bookId] = list;
  else delete all[bookId];
  writeJSON('bookmarks.json', all);
  return list;
};

exports.getSettings = function () {
  return readJSON('settings.json', defaultSettings);
};

exports.saveSettings = function (settings) {
  writeJSON('settings.json', settings);
  return settings;
};

const appearances = ['system', 'light', 'dark'];

/** 全应用外观：跟随系统 / 浅色 / 深色，单独存一个文件，不和阅读设置互相覆盖 */
exports.getAppearance = function () {
  const mode = readJSON('appearance.json', 'system');
  return appearances.includes(mode) ? mode : 'system';
};

exports.saveAppearance = function (mode) {
  const value = appearances.includes(mode) ? mode : 'system';
  writeJSON('appearance.json', value);
  return value;
};

const defaultMoyu = {
  bounds: null,
  opacity: 0,
  fontSize: 15,
  color: 'dark',
};

/** 摸鱼窗口的位置、大小和外观，单独一个文件 */
exports.getMoyu = function () {
  return { ...defaultMoyu, ...readJSON('moyu.json', {}) };
};

exports.saveMoyu = function (patch) {
  const value = { ...exports.getMoyu(), ...patch };
  writeJSON('moyu.json', value);
  return value;
};
