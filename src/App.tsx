import { Routes, Route } from 'react-router-dom';
import Layout from './components/Layout';
import Home from './pages/Home';
import Search from './pages/Search';
import Bookshelf from './pages/Bookshelf';
import BookDetail from './pages/BookDetail';
import Reader from './pages/Reader';

export default function App() {
  return (
    <Routes>
      <Route path="/reader/:bookId/:chapterId" element={<Reader />} />
      <Route element={<Layout />}>
        <Route index element={<Home />} />
        <Route path="/search" element={<Search />} />
        <Route path="/bookshelf" element={<Bookshelf />} />
        <Route path="/book/:id" element={<BookDetail />} />
      </Route>
    </Routes>
  );
}
