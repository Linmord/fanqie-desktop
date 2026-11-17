import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { SyncOutlined } from '@ant-design/icons';
import { useBookshelf } from '@/stores/bookshelf';
import { useAccount } from '@/stores/account';

export default function Bookshelf() {
  const { items, loading, syncing, load, sync, remove } = useBookshelf();
  const { user, openLogin } = useAccount();
  const nav = useNavigate();

  useEffect(() => { load(); }, [load]);

  if (loading) return <div className="loading">加载中...</div>;

  return (
    <div>
      <div className="shelf-header">
        <h1 className="page-title">我的书架</h1>
        {user ? (
          <button className="shelf-sync" onClick={sync} disabled={syncing}>
            <SyncOutlined spin={syncing} />
            {syncing ? '同步中…' : '已与番茄账号同步'}
          </button>
        ) : (
          <button className="shelf-sync" onClick={openLogin}>
            登录后与番茄小说 App 同步书架
          </button>
        )}
      </div>

      {items.length === 0 ? (
        <div className="empty-state">
          <p>书架空空如也</p>
          <p>去发现或搜索页面添加喜欢的书籍吧</p>
        </div>
      ) : (
        <div className="book-grid">
          {items.map((item) => (
            <div
              key={item.book.id}
              className="book-card bookshelf-card"
              onClick={() => {
                if (item.lastReadChapterId) {
                  nav(`/reader/${item.book.id}/${item.lastReadChapterId}`);
                } else {
                  nav(`/book/${item.book.id}`);
                }
              }}
            >
              <button
                className="bookshelf-remove"
                onClick={(e) => {
                  e.stopPropagation();
                  remove(item.book.id);
                }}
              >
                ×
              </button>
              <img
                className="book-cover"
                src={item.book.cover || undefined}
                alt={item.book.title}
                onError={(e) => {
                  (e.target as HTMLImageElement).style.display = 'none';
                }}
              />
              <div className="book-title" title={item.book.title}>{item.book.title}</div>
              <div className="book-author">{item.book.author}</div>
              {item.lastReadChapterTitle && (
                <div className="bookshelf-progress">
                  读到：{item.lastReadChapterTitle}
                </div>
              )}
              {!item.lastReadChapterTitle && item.progress > 0 && (
                <div className="bookshelf-progress">已读 {Math.round(item.progress * 100)}%</div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
