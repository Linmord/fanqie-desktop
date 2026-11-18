/** 书籍信息 */
export interface Book {
  id: string;
  title: string;
  author: string;
  cover: string;
  description: string;
  category: string;
  wordCount: number;
  status: '连载中' | '已完结';
  latestChapter: string;
}

/** 章节信息 */
export interface Chapter {
  id: string;
  title: string;
  bookId: string;
  index: number;
  content?: string;
  isVip: boolean;
}

/** 搜索结果 */
export interface SearchResult {
  books: Book[];
  total: number;
  hasMore: boolean;
}

/** 书架条目 */
export interface BookshelfItem {
  book: Book;
  lastReadChapterId: string;
  lastReadChapterTitle: string;
  /** 章内读到第几段（按正文行序号），只存本地，不同步云端 */
  lastReadParaIndex?: number;
  progress: number;
  addedAt: string;
  updatedAt: string;
}

/** 全应用外观模式 */
export type Appearance = 'system' | 'light' | 'dark';

/** 阅读器主题：auto 跟随应用明暗，其余为固定主题，颜色定义在 index.css */
export type ReaderThemeId = 'auto' | 'ivory' | 'paper' | 'night';

/** 阅读器正文字体 */
export type ReaderFontId = 'serif' | 'sans' | 'kai';

/** 阅读模式 */
export type ReadingMode = 'scroll' | 'page';

/** 阅读器设置 */
/** 书签：记到某章某一段（原始行号），只存本地 */
export interface Bookmark {
  chapterId: string;
  chapterTitle: string;
  para: number;
  /** 段首摘录 */
  excerpt: string;
  createdAt: number;
}

export interface ReaderSettings {
  fontSize: number;
  lineHeight: number;
  pageWidth: number;
  theme: ReaderThemeId;
  fontFamily: ReaderFontId;
  readingMode: ReadingMode;
  /** 段间距，单位 em */
  paraSpacing: number;
  /** 段首空两字 */
  indent: boolean;
}

/** 番茄账号 */
export interface FanqieUser {
  id: string;
  name: string;
  avatar: string;
  isVip: boolean;
}

/** 扫码状态 */
export interface QrcodeStatus {
  status: 'new' | 'scanned' | 'expired' | 'success' | 'error';
  user?: FanqieUser | null;
  message?: string;
}

/** 章节正文；paraIdx 与 content 按行一一对应，是段评用的段落序号 */
export interface ChapterContent {
  content: string;
  fontCss: string;
  paraIdx?: number[];
}

/** 听书音色：AI 朗读的 key 是音色 id，真人主播的 key 是 abook:有声书 id */
export interface AudioTone {
  key: string;
  kind: 'tts' | 'narrator';
  title: string;
  /** 官方的一句话介绍，如"自然流畅" */
  description: string;
}

/** 听书时间轴里的一句：para 是段评同款段落 idx，10000 表示标题；时间为毫秒 */
export interface AudioTimepoint {
  start: number;
  end: number;
  para: number;
}

/** 真人主播一章的音频，及每段在音频里的时间 */
export interface AudioNarration {
  url: string;
  backupUrl: string;
  points: AudioTimepoint[];
}

/** 段评或回复 */
export interface ParaComment {
  id: string;
  isReply: boolean;
  userId: string;
  serviceId: number;
  /** 当前登录账号是否赞过 */
  liked: boolean;
  text: string;
  /** 评论配图：thumb 是缩略图，url 是原图 */
  images: { thumb: string; url: string; width: number; height: number }[];
  time: number;
  userName: string;
  avatar: string;
  isAuthor: boolean;
  isVip: boolean;
  titles: string[];
  diggCount: number;
  replyCount: number;
  authorLiked: boolean;
  replyTo: string;
}

export interface CommentPage {
  comments: ParaComment[];
  cursor: string;
  hasMore: boolean;
  total: number;
}

export interface ReplyPage {
  replies: ParaComment[];
  cursor: string;
  hasMore: boolean;
}

/** 摸鱼窗口的位置大小和外观；opacity 是底色不透明度 0~0.6，color 是文字颜色 */
export interface MoyuPrefs {
  bounds: { x: number; y: number; width: number; height: number } | null;
  opacity: number;
  fontSize: number;
  color: 'light' | 'dark';
}
