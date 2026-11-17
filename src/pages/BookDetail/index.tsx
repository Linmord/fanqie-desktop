import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import * as api from '@/services/api';
import { useBookshelf } from '@/stores/bookshelf';
import type { Book, Chapter } from '@/types';

export default function BookDetail() {
  const { id } = useParams<{ id: string }>();
  const nav = useNavigate();
  const { isInShelf, add, remove } = useBookshelf();

  const [book, setBook] = useState<Book | null>(null);
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [loading, setLoading] = useState(true);

  const inShelf = id ? isInShelf(id) : false;

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    Promise.all([api.bookDetail(id), api.chapters(id)]).then(([b, chs]) => {
      setBook(b);
      setChapters(chs);
      setLoading(false);
    });
  }, [id]);

  if (loading) return <div className="loading">加载中...</div>;
  if (!book) return <div className="empty-state"><p>书籍不存在</p></div>;

  const startReading = () => {
    if (chapters.length > 0) {
      nav(`/reader/${book.id}/${chapters[0].id}`);
    }
  };

  return (
    <div>
      <div className="detail-header">
        <img className="detail-cover" src={book.cover || undefined} alt={book.title} />
        <div className="detail-info">
          <h1 className="detail-title">{book.title}</h1>
          <div className="detail-meta">
            <span>{book.author}</span>
            <span>{book.category}</span>
            <span>{book.status}</span>
            {book.wordCount > 0 && (
              <span>{(book.wordCount / 10000).toFixed(1)}万字</span>
            )}
          </div>
          <p className="detail-desc">{book.description}</p>
          <div className="detail-actions">
            <button className="btn-primary" onClick={startReading}>
              开始阅读
            </button>
            <button
              className="btn-secondary"
              onClick={() => inShelf ? remove(book.id) : add(book)}
            >
              {inShelf ? '移出书架' : '加入书架'}
            </button>
          </div>
        </div>
      </div>

      <h2 className="section-title">目录（{chapters.length}章）</h2>
      <ul className="chapter-list">
        {chapters.map((ch) => (
          <li
            key={ch.id}
            className="chapter-item"
            onClick={() => nav(`/reader/${book.id}/${ch.id}`)}
          >
            {ch.title}
            {ch.isVip && <span style={{ color: 'var(--accent)', marginLeft: 6, fontSize: 11 }}>VIP</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}
