import { parse, stringify } from 'smol-toml';

/**
 * 配置合并/差异相关的公共逻辑。
 * 信任类配置（[projects] 的 trust_level、trusted_sources）以本机文件（云端）为准，
 * 应用不覆盖它们 —— 保存/同步时这些键的差异一律忽略。
 */
export const IGNORED_CONFIG_KEYS = ['projects', 'trusted_sources'];

/** 合并：用户编辑内容（db）为基础，信任类键以云端（本机文件）为准。 */
export function mergeConfigWithCloud(dbContent: string, cloudContent: string): string {
  let db: Record<string, unknown>;
  let cloud: Record<string, unknown>;
  try {
    db = parse(dbContent) as Record<string, unknown>;
  } catch {
    return cloudContent; // 数据库内容解析失败：以云端为准
  }
  try {
    cloud = parse(cloudContent) as Record<string, unknown>;
  } catch {
    return dbContent; // 云端解析失败：无法合并，以数据库为准
  }
  for (const key of IGNORED_CONFIG_KEYS) {
    if (cloud[key] !== undefined) {
      db[key] = cloud[key]; // 信任类配置保留云端值
    } else {
      delete db[key]; // 云端没有 → 不写入
    }
  }
  return stringify(db);
}

/** 结构化差异项（忽略键顺序与信任类配置）。 */
export interface ConfigDiffItem {
  path: string;
  db: unknown;
  cloud: unknown;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** 递归比较两边配置对象，返回差异路径列表（信任类键忽略）。 */
export function collectConfigDiffs(
  db: Record<string, unknown>,
  cloud: Record<string, unknown>,
  prefix = '',
): ConfigDiffItem[] {
  const diffs: ConfigDiffItem[] = [];
  const keys = new Set([...Object.keys(db), ...Object.keys(cloud)]);
  for (const key of keys) {
    if (IGNORED_CONFIG_KEYS.includes(key)) continue;
    const path = prefix ? `${prefix}.${key}` : key;
    const dbValue = db[key];
    const cloudValue = cloud[key];
    if (isPlainObject(dbValue) && isPlainObject(cloudValue)) {
      diffs.push(...collectConfigDiffs(dbValue, cloudValue, path));
    } else if (JSON.stringify(dbValue) !== JSON.stringify(cloudValue)) {
      diffs.push({ path, db: dbValue, cloud: cloudValue });
    }
  }
  return diffs;
}

/** 展示用：值格式化（对象/数组紧凑 JSON，标量原样）。 */
export function formatConfigValue(value: unknown): string {
  if (value === undefined) return '（无）';
  if (typeof value === 'string') return value;
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') return String(value);
  return JSON.stringify(value);
}
