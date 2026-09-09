export interface TextMatch {
  start: number;
  end: number;
}

/** 按字面、不区分大小写查找，保留原文下标供高亮和定位使用。 */
export function findTextMatches(text: string, search: string): TextMatch[] {
  const keyword = search.trim();
  if (!keyword) return [];
  const pattern = new RegExp(keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'giu');
  return Array.from(text.matchAll(pattern), match => ({
    start: match.index!,
    end: match.index! + match[0].length,
  }));
}
