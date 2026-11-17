const { BrowserWindow, ipcMain, screen } = require('electron');
const path = require('path');
const store = require('./services/store');

const isMac = process.platform === 'darwin';
let win = null;
let mainWasFullScreen = false;

// 上次的位置所在的显示器已经拔掉时，退回默认位置
function savedBounds() {
  const { bounds } = store.getMoyu();
  if (!bounds) return {};
  const visible = screen.getAllDisplays().some(({ workArea: a }) =>
    bounds.x < a.x + a.width && bounds.x + bounds.width > a.x && bounds.y < a.y + a.height && bounds.y + bounds.height > a.y);
  return visible ? bounds : {};
}

/**
 * 摸鱼窗口：无边框、背景透明、置顶，只浮着几行正文。
 * getMainWindow 取主窗口；loadRoute(win, route) 按开发/打包环境加载页面路由。
 */
exports.setup = function ({ getMainWindow, loadRoute }) {
  ipcMain.handle('moyu:open', (_e, bookId, chapterId, para) => {
    if (win) return win.focus();
    win = new BrowserWindow({
      width: 420,
      height: 220,
      ...savedBounds(),
      minWidth: 200,
      minHeight: 80,
      frame: false,
      transparent: true,
      hasShadow: false,
      backgroundColor: '#00000000',
      alwaysOnTop: true,
      skipTaskbar: true,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      show: false,
      // panel 才能浮在别的 App 的全屏窗口上
      ...(isMac && { type: 'panel' }),
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
      },
    });
    win.setAlwaysOnTop(true, 'floating');
    // 切桌面、别的 App 全屏时跟过去；不改进程类型，否则 Dock 图标会消失
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true });
    // 截图和共享屏幕时显示为空白
    win.setContentProtection(true);
    loadRoute(win, `/moyu/${bookId}/${chapterId}?para=${para}`);

    const w = win;
    w.once('ready-to-show', () => {
      w.show();
      const main = getMainWindow();
      if (!main) return;
      // macOS 上直接隐藏全屏窗口会留下一个黑屏的空桌面，先退出全屏再藏，退出摸鱼时再全屏回去
      mainWasFullScreen = main.isFullScreen();
      if (mainWasFullScreen) {
        main.once('leave-full-screen', () => main.hide());
        main.setFullScreen(false);
      } else {
        main.hide();
      }
    });
    w.on('close', () => store.saveMoyu({ bounds: w.getBounds() }));
    w.on('closed', () => {
      win = null;
    });
  });

  // 退出摸鱼：主窗口回来，并跳到摸鱼窗口读到的位置
  ipcMain.handle('moyu:close', (_e, chapterId, para) => {
    const main = getMainWindow();
    if (main) {
      main.show();
      if (mainWasFullScreen) main.setFullScreen(true);
      main.webContents.send('moyu:exit', { chapterId, para });
    }
    mainWasFullScreen = false;
    win?.close();
  });

  ipcMain.handle('moyu:setBounds', (e, bounds) => BrowserWindow.fromWebContents(e.sender)?.setBounds(bounds));
  ipcMain.handle('moyu:getPrefs', () => store.getMoyu());
  ipcMain.handle('moyu:savePrefs', (_e, patch) => store.saveMoyu(patch));
};
