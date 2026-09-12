export type CommandCategory = "action" | "navigation";

export interface CommandItem {
  id: string;
  title: string;
  description: string;
  category: CommandCategory;
  icon: string;
  shortcutHint?: string;
  keywords?: string[];
  perform: () => void;
}

export function filterCommands(
  commands: readonly CommandItem[],
  query: string,
): CommandItem[] {
  const trimmed = query.trim().toLowerCase();
  if (!trimmed) {
    return [...commands];
  }

  const terms = trimmed.split(/\s+/).filter(Boolean);

  const scored: Array<{ item: CommandItem; score: number }> = [];

  for (const item of commands) {
    const titleLower = item.title.toLowerCase();
    const descLower = item.description.toLowerCase();
    const keywordsLower = item.keywords?.map((k) => k.toLowerCase()) ?? [];

    let totalScore = 0;
    let matchesAll = true;

    for (const term of terms) {
      let termScore = 0;
      if (titleLower.startsWith(term)) {
        termScore = Math.max(termScore, 100);
      } else if (titleLower.includes(term)) {
        termScore = Math.max(termScore, 70);
      }

      for (const kw of keywordsLower) {
        if (kw.startsWith(term)) {
          termScore = Math.max(termScore, 50);
        } else if (kw.includes(term)) {
          termScore = Math.max(termScore, 30);
        }
      }

      if (descLower.includes(term)) {
        termScore = Math.max(termScore, 20);
      }

      if (termScore === 0) {
        matchesAll = false;
        break;
      }
      totalScore += termScore;
    }

    if (matchesAll && totalScore > 0) {
      if (item.category === "action") {
        totalScore += 5; // Actions slightly prioritized over pure navigation
      }
      scored.push({ item, score: totalScore });
    }
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.map((s) => s.item);
}
