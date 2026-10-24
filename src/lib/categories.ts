const CATEGORY_KO: Record<string, string> = {
  'Art - Anime': '아트 · 애니메이션',
  'Art - Doujinshi': '아트 · 동인지',
  'Art - Games': '아트 · 게임',
  'Art - Manga': '아트 · 만화',
  'Art - Pictures': '아트 · 그림',
  'Real Life - Photobooks and Pictures': '실사 · 화보/사진',
  'Real Life - Videos': '실사 · 영상',
}

export function categoryLabel(category: string) {
  return CATEGORY_KO[category] ?? category
}
