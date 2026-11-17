const { app, dialog, shell } = require('electron');
const { autoUpdater } = require('electron-updater');

const RELEASES = 'https://github.com/MoYiC6/fanqie-desktop/releases/latest';

// 从 GitHub Release 检查更新。
// Windows / Linux：后台下载，下载完问是否立即重启安装。
// macOS：安装包没有代码签名，Squirrel.Mac 会拒绝替换，只提示新版本并打开下载页。
function checkForUpdates(win) {
  if (!app.isPackaged) return;
  const isMac = process.platform === 'darwin';
  autoUpdater.autoDownload = !isMac;

  autoUpdater.on('error', (err) => console.warn('检查更新失败:', err.message));

  autoUpdater.on('update-available', async ({ version }) => {
    if (!isMac) return;
    const { response } = await dialog.showMessageBox(win, {
      type: 'info',
      message: `发现新版本 v${version}`,
      detail: `当前版本 v${app.getVersion()}，前往 GitHub 下载新版安装包。`,
      buttons: ['去下载', '稍后'],
      defaultId: 0,
      cancelId: 1,
    });
    if (response === 0) shell.openExternal(RELEASES);
  });

  autoUpdater.on('update-downloaded', async ({ version }) => {
    const { response } = await dialog.showMessageBox(win, {
      type: 'info',
      message: `新版本 v${version} 已下载`,
      detail: '重启后完成更新。选择“稍后”则在下次退出时自动安装。',
      buttons: ['立即重启', '稍后'],
      defaultId: 0,
      cancelId: 1,
    });
    if (response === 0) autoUpdater.quitAndInstall();
  });

  autoUpdater.checkForUpdates().catch(() => {});
}

module.exports = { checkForUpdates };
