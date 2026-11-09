/** 比较 x.y.z 版本号：candidate 是否高于 current。 */
export function isVersionNewer(candidate: string, current: string): boolean {
  const parse = (version: string) =>
    version.split('.').map((part) => Number.parseInt(part, 10) || 0);

  const left = parse(candidate);
  const right = parse(current);
  const length = Math.max(left.length, right.length);

  for (let index = 0; index < length; index += 1) {
    const a = left[index] ?? 0;
    const b = right[index] ?? 0;
    if (a !== b) return a > b;
  }

  return false;
}
