import { useEffect, useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { Avatar, Dropdown, Tooltip, message } from 'antd';
import {
  HomeOutlined,
  SearchOutlined,
  BookOutlined,
  UserOutlined,
  DesktopOutlined,
  SunOutlined,
  MoonOutlined,
  GithubOutlined,
} from '@ant-design/icons';
import { useAccount } from '@/stores/account';
import { useBookshelf } from '@/stores/bookshelf';
import { useTheme, appearanceLabel } from '@/stores/theme';
import AboutModal from '@/components/AboutModal';
import * as api from '@/services/api';

const appearanceIcon = {
  system: <DesktopOutlined />,
  light: <SunOutlined />,
  dark: <MoonOutlined />,
};

// 老板键被占用的提示每次启动只弹一次，Layout 重新挂载时不重复
let bossKeyChecked = false;

const navItems = [
  { to: '/', icon: <HomeOutlined />, label: '发现' },
  { to: '/search', icon: <SearchOutlined />, label: '搜索' },
  { to: '/bookshelf', icon: <BookOutlined />, label: '书架' },
];

export default function Layout() {
  const { user, ready, init, openLogin, logout } = useAccount();
  const { appearance, cycle } = useTheme();
  const [aboutOpen, setAboutOpen] = useState(false);

  // 启动时恢复登录态，再加载书架（登录了就顺带拉一次云书架）
  useEffect(() => {
    init().then(() => useBookshelf.getState().load());
  }, [init]);

  useEffect(() => {
    if (bossKeyChecked) return;
    bossKeyChecked = true;
    api.bossKeyRegistered().then((ok) => {
      if (!ok) message.warning('老板键 ⌥+Q 被其他 App 占用，暂时无法使用');
    });
  }, []);

  return (
    <>
      <aside className="sidebar">
        <nav className="sidebar-nav">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              className={({ isActive }) =>
                `sidebar-item${isActive ? ' active' : ''}`
              }
            >
              {item.icon}
              <span>{item.label}</span>
            </NavLink>
          ))}
        </nav>

        <div className="sidebar-account">
          {ready && (user ? (
            <Dropdown
              trigger={['click']}
              placement="topLeft"
              menu={{
                items: [{ key: 'logout', label: '退出登录' }],
                onClick: async () => {
                  await logout();
                  useBookshelf.getState().load();
                },
              }}
            >
              <button className="account-btn">
                <Avatar size={28} src={user.avatar || undefined} icon={<UserOutlined />} />
                <span className="account-name">{user.name}</span>
                {user.isVip && <span className="vip-badge">VIP</span>}
              </button>
            </Dropdown>
          ) : (
            <button className="account-btn" onClick={openLogin}>
              <Avatar size={28} icon={<UserOutlined />} />
              <span className="account-name">登录番茄账号</span>
            </button>
          ))}
          <Tooltip title={`外观：${appearanceLabel[appearance]}`} placement="top">
            <button className="appearance-btn" onClick={cycle}>
              {appearanceIcon[appearance]}
            </button>
          </Tooltip>
          <Tooltip title="开源与关于" placement="top">
            <button className="appearance-btn" onClick={() => setAboutOpen(true)}>
              <GithubOutlined />
            </button>
          </Tooltip>
        </div>
      </aside>
      <AboutModal open={aboutOpen} onClose={() => setAboutOpen(false)} />
      <div className="titlebar-drag" />
      <main className="content">
        <Outlet />
      </main>
    </>
  );
}
