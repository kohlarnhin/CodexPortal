type ConfigObject = Record<string, unknown>;

function isObject(value: unknown): value is ConfigObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date);
}

function equivalent(left: unknown, right: unknown): boolean {
  if (isObject(left) && isObject(right)) {
    const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
    return [...keys].every(key => equivalent(left[key], right[key]));
  }
  if (Array.isArray(left) && Array.isArray(right)) {
    return left.length === right.length && left.every((value, i) => equivalent(value, right[i]));
  }
  if (left instanceof Date && right instanceof Date) return left.toISOString() === right.toISOString();
  return Object.is(left, right);
}

export interface ConfigDiffItem {
  path: string;
  oldValue: unknown;
  newValue: unknown;
}

export function collectConfigDiffs(before: ConfigObject, after: ConfigObject, prefix = ''): ConfigDiffItem[] {
  return [...new Set([...Object.keys(before), ...Object.keys(after)])].flatMap(key => {
    const path = prefix ? `${prefix}.${key}` : key;
    if (isObject(before[key]) && isObject(after[key])) {
      return collectConfigDiffs(before[key], after[key], path);
    }
    return equivalent(before[key], after[key]) ? [] : [{ path, oldValue: before[key], newValue: after[key] }];
  });
}

/** 仅将本次编辑应用到最新文件；其他字段保留，冲突字段拒绝覆盖。 */
export function mergeConfigChanges(base: ConfigObject, edited: ConfigObject, latest: ConfigObject): ConfigObject {
  function merge(before: unknown, after: unknown, current: unknown, path: string): unknown {
    if (equivalent(before, after)) return current;
    if (equivalent(current, after) || equivalent(current, before)) return after;
    if ((isObject(before) || before === undefined) && isObject(after) && isObject(current)) {
      const original = isObject(before) ? before : {};
      return Object.fromEntries(
        [...new Set([...Object.keys(original), ...Object.keys(after), ...Object.keys(current)])]
          .map(key => [key, merge(original[key], after[key], current[key], path ? `${path}.${key}` : key)])
          .filter(([, value]) => value !== undefined),
      );
    }
    throw new Error(`本地配置中的 ${path} 已被外部修改，请重新载入后再保存。`);
  }
  return merge(base, edited, latest, '') as ConfigObject;
}
