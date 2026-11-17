/**
 * 正文按行拆成段落：去掉每段首尾的空白（trim 也会去掉全角空格），丢掉空行。
 * line 是原始行号，段评的 paraIdx 按它对应，清洗不会让段评错位。
 */
export function splitParagraphs(content: string): { text: string; line: number }[] {
  return content.split('\n').flatMap((raw, line) => {
    const text = raw.trim();
    return text ? [{ text, line }] : [];
  });
}
