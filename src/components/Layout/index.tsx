import { useEffect } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { Avatar, Dropdown } from 'antd';
import {
  HomeOutlined,
  SearchOutlined,
  BookOutlined,
  UserOutlined,
} from '@ant-design/icons';
import { useAccount } from '@/stores/account';
import { useBookshelf } from '@/stores/bookshelf';

const navItems = [
  { to: '/', icon: <HomeOutlined />, label: '发现' },
  { to: '/search', icon: <SearchOutlined />, label: '搜索' },
  { to: '/bookshelf', icon: <BookOutlined />, label: '书架' },
];

export default function Layout() {
  const { user, ready, init, openLogin, logout } = useAccount();

  // 启动时恢复登录态，再加载书架（登录了就顺带拉一次云书架）
  useEffect(() => {
    init().then(() => useBookshelf.getState().load());
  }, [init]);

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

        {ready && (
          <div className="sidebar-account">
            {user ? (
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
            )}
          </div>
        )}
      </aside>
      <main className="content">
        <Outlet />
      </main>
    </>
  );
}
