/** token 数量格式化：1.2K / 17.6M / 2.5B（≥1000M 进位到 B）。 */
export function formatTokens(n: number | null | undefined): string {
  if (!n || n <= 0) return '0';
  if (n >= 1_000_000_000) {
    const value = n / 1_000_000_000;
    return `${value >= 100 ? Math.round(value) : value.toFixed(1)}B`;
  }
  if (n >= 1_000_000) {
    const value = n / 1_000_000;
    return `${value >= 100 ? Math.round(value) : value.toFixed(1)}M`;
  }
  if (n >= 1_000) {
    const value = n / 1_000;
    return `${value >= 100 ? Math.round(value) : value.toFixed(1)}K`;
  }
  return `${n}`;
}
