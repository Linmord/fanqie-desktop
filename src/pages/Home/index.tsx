import { useEffect, useState } from 'react';
import BookCard from '@/components/BookCard';
import * as api from '@/services/api';
import type { Book } from '@/types';

export default function Home() {
  const [books, setBooks] = useState<Book[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeCategory, setActiveCategory] = useState('0');

  const categories = [
    { id: '0', name: '推荐' },
    { id: '7', name: '玄幻' },
    { id: '1', name: '都市' },
    { id: '12', name: '现言' },
    { id: '13', name: '古言' },
    { id: '11', name: '科幻' },
    { id: '5', name: '历史' },
    { id: '14', name: '幻想' },
  ];

  useEffect(() => {
    setLoading(true);
    api.ranking(activeCategory, 0).then((res) => {
      setBooks(res.books);
      setLoading(false);
    });
  }, [activeCategory]);

  return (
    <div>
      <h1 className="page-title">发现好书</h1>

      <div className="category-tabs">
        {categories.map((cat) => (
          <button
            key={cat.id}
            className={`category-tab${activeCategory === cat.id ? ' active' : ''}`}
            onClick={() => setActiveCategory(cat.id)}
          >
            {cat.name}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="loading">加载中...</div>
      ) : books.length > 0 ? (
        <div className="book-grid">
          {books.map((book) => (
            <BookCard key={book.id} book={book} />
          ))}
        </div>
      ) : (
        <div className="empty-state">
          <p>暂无内容，请稍后再试</p>
        </div>
      )}
    </div>
  );
}
