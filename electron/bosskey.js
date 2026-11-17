const { app, BrowserWindow, globalShortcut } = require('electron');

// 老板键：全局生效，在别的 App 里按也能藏起来
const ACCELERATOR = 'Alt+Q';
const isMac = process.platform === 'darwin';

// macOS 上记是否藏着；其他平台记被藏起来的窗口，再按一次时只恢复这些
let macHidden = false;
let hidden = [];
let registered = false;

function toggleMac() {
  if (macHidden) {
    macHidden = false;
    app.dock?.show();
    // 只恢复藏之前可见的窗口，不抢焦点
    app.show();
    return;
  }
  if (!BrowserWindow.getAllWindows().some((w) => w.isVisible())) return;
  macHidden = true;
  app.dock?.hide();
  // 等同 ⌘H：全屏窗口也能正确藏起来，焦点还给之前的 App
  app.hide();
}

function toggleOthers() {
  if (hidden.length) {
    const wins = hidden.filter((w) => !w.isDestroyed());
    hidden = [];
    // 摸鱼窗口置顶浮着，恢复时不抢焦点；主窗口正常显示
    for (const w of wins) (w.isAlwaysOnTop() ? w.showInactive() : w.show());
    return;
  }
  hidden = BrowserWindow.getAllWindows().filter((w) => w.isVisible());
  for (const w of hidden) w.hide();
}

exports.register = function () {
  registered = globalShortcut.register(ACCELERATOR, isMac ? toggleMac : toggleOthers);
  if (!registered) console.warn(`老板键 ${ACCELERATOR} 注册失败，可能被其他 App 占用`);
  app.on('will-quit', () => globalShortcut.unregisterAll());
};

exports.isRegistered = () => registered;
