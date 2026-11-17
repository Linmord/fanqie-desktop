import { useState, useCallback } from 'react';
import BookCard from '@/components/BookCard';
import * as api from '@/services/api';
import type { Book } from '@/types';

export default function Search() {
  const [query, setQuery] = useState('');
  const [books, setBooks] = useState<Book[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);

  const doSearch = useCallback(async () => {
    const q = query.trim();
    if (!q) return;
    setLoading(true);
    setSearched(true);
    const res = await api.search(q, 0);
    setBooks(res.books);
    setLoading(false);
  }, [query]);

  return (
    <div>
      <h1 className="page-title">搜索</h1>

      <div className="search-bar">
        <input
          placeholder="输入书名或作者..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && doSearch()}
        />
        <button onClick={doSearch}>搜索</button>
      </div>

      {loading ? (
        <div className="loading">搜索中...</div>
      ) : books.length > 0 ? (
        <div className="book-grid">
          {books.map((book) => (
            <BookCard key={book.id} book={book} />
          ))}
        </div>
      ) : searched ? (
        <div className="empty-state">
          <p>未找到相关书籍</p>
        </div>
      ) : (
        <div className="empty-state">
          <p>搜索你想看的小说</p>
        </div>
      )}
    </div>
  );
}
