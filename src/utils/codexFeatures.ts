/**
 * Codex 官方配置的功能开关（features）常用清单。
 * 来源：https://learn.chatgpt.com/docs/config-schema.json（ConfigProfile.features，共 114 个键，
 * 这里只保留常用的；官方支持但本地缺失的开关在界面展示为"关闭"（默认值），
 * 保存/一致性检查时视为差异，由用户自行决定是否写入，不会初始化就写进本地配置。
 */
export interface OfficialFeature {
  label: string;
  description?: string;
  /** 官方默认开启（不配置也生效），界面标注提示，避免用户误关后实际行为不变。 */
  defaultEnabled?: boolean;
}

export const OFFICIAL_FEATURES: Record<string, OfficialFeature> = {
  multi_agent: { label: '多智能体', description: '启用子代理工具（spawn/wait/close_agent）；关联 [agents] 表配置', defaultEnabled: true },
  multi_agent_v2: { label: '多智能体 V2', description: '新一代多智能体，开启时优先于 multi_agent；需要调整参数时在高级配置里写 [features.multi_agent_v2]' },
  collaboration_modes: { label: '协作模式', description: '协作模式（default / plan 等）' },
  skills: { label: '技能系统', description: 'Skills（SKILL.md 自动发现，~/.agents/skills）', defaultEnabled: true },
  hooks: { label: '生命周期钩子', description: 'hooks.json 钩子事件（SessionStart、PreToolUse 等）' },
  goals: { label: '目标系统', description: '目标驱动开发（goals）' },
  memories: { label: '记忆系统', description: '持久记忆工具' },
  apps: { label: '应用模式', description: '应用模式（apps）' },
  plugins: { label: '插件系统', description: '插件（plugins）' },
  fast_mode: { label: '极速模式', description: '快速模式（更快输出）' },
  web_search: { label: '网页搜索', description: '网页搜索工具（默认 cached 模式）', defaultEnabled: true },
  search_tool: { label: '搜索工具', description: '内置搜索工具' },
  image_generation: { label: '图片生成', description: '图片生成工具' },
  shell_tool: { label: 'Shell 工具', description: '终端命令执行工具（核心工具）', defaultEnabled: true },
  terminal_resize_reflow: { label: '终端自适应重排', description: '终端窗口变化时重排内容' },
  default_mode_request_user_input: { label: '默认请求输入', description: '默认模式下允许请求用户输入' },
  computer_use: { label: '电脑操作', description: 'Computer Use（操作桌面/浏览器）' },
  browser_use: { label: '浏览器操作', description: '浏览器自动化（browser_use）' },
  remote_control: { label: '远程控制', description: '远程控制支持' },
  sqlite: { label: 'SQLite 存储', description: 'SQLite 本地存储' },
};

/** 官方 features 键的有序列表（界面按此顺序渲染）。 */
export const OFFICIAL_FEATURE_KEYS = Object.keys(OFFICIAL_FEATURES);
