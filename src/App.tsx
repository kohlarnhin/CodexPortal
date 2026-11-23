import { useEffect, useState } from 'react';
import { getVersion } from '@tauri-apps/api/app';
import {
  ChartNoAxesColumnIncreasing,
  FileText,
  Info,
  LayoutDashboard,
  MessageSquare,
  Plug,
  Settings2,
  SlidersHorizontal,
  Terminal,
  Users,
  WandSparkles,
  type LucideIcon,
} from 'lucide-react';
import AccountList from './components/AccountList';
import Settings from './components/Settings';
import AppSettings from './components/AppSettings';
import ActiveAccount from './components/ActiveAccount';
import SessionsPage from './components/SessionsPage';
import TokenUsagePage from './components/TokenUsagePage';
import MCPManager from './components/MCPManager';
import SkillManager from './components/SkillManager';
import CodexInfo from './components/CodexInfo';
import LogsPage from './components/LogsPage';
import About from './components/About';
import UpdateModal from './components/UpdateModal';
import Logo from './components/Logo';
import SidebarAccountStatus from './components/SidebarAccountStatus';
import { Toaster } from './components/ui/toast';
import { ActionTooltip, TooltipProvider } from './components/ui/tooltip';
import { cn } from './lib/utils';
import { useUpdater } from './hooks/useUpdater';
import { useEmailMasking } from './hooks/useEmailMasking';
import { useAccountUsageScheduler } from './hooks/useAccountUsageScheduler';
import { useAutostart } from './hooks/useAutostart';
import { useSystemTray } from './hooks/useSystemTray';
import { useCodexRateLimitListener } from './hooks/useCodexRateLimitListener';
import { useAppearance } from './hooks/useAppearance';

type TabId =
  | 'dashboard'
  | 'accounts'
  | 'sessions'
  | 'token-usage'
  | 'settings'
  | 'mcp'
  | 'skills'
  | 'codex-info'
  | 'logs'
  | 'app-settings'
  | 'about';

interface NavItem {
  id: TabId;
  label: string;
  icon: LucideIcon;
}

const NAV_GROUPS: Array<{ label: string; items: NavItem[] }> = [
  {
    label: '账号',
    items: [
      { id: 'dashboard', label: '当前账号', icon: LayoutDashboard },
      { id: 'accounts', label: '账号管理', icon: Users },
    ],
  },
  {
    label: 'Codex',
    items: [
      { id: 'sessions', label: '会话管理', icon: MessageSquare },
      { id: 'token-usage', label: 'Token 用量', icon: ChartNoAxesColumnIncreasing },
      { id: 'settings', label: '配置管理', icon: Settings2 },
      { id: 'mcp', label: 'MCP 配置', icon: Plug },
      { id: 'skills', label: 'Skill 管理', icon: WandSparkles },
      { id: 'codex-info', label: 'Codex 信息', icon: Terminal },
    ],
  },
  {
    label: '应用',
    items: [
      { id: 'logs', label: '日志', icon: FileText },
      { id: 'app-settings', label: '设置', icon: SlidersHorizontal },
      { id: 'about', label: '关于', icon: Info },
    ],
  },
];

function App() {
  const [activeTab, setActiveTab] = useState<TabId>('dashboard');
  const [detailContainer, setDetailContainer] = useState<HTMLDivElement | null>(null);
  const { appearance, setAppearance } = useAppearance();
  const updater = useUpdater();
  const { isEmailMaskingEnabled, toggleEmailMasking } = useEmailMasking();
  const usageScheduler = useAccountUsageScheduler(isEmailMaskingEnabled);
  const autostart = useAutostart();
  const systemTray = useSystemTray(isEmailMaskingEnabled, setActiveTab as (tab: string) => void);
  const codexEvents = useCodexRateLimitListener();
  const [appVersion, setAppVersion] = useState<string | null>(null);
  const availableUpdate = updater.update?.version ?? null;

  useEffect(() => {
    getVersion().then(setAppVersion).catch(error => console.warn('Failed to read app version:', error));
  }, []);

  // 自动检查发现新版本时跳转到"关于"页，让用户看到版本更新提示。
  useEffect(() => {
    if (updater.promptRevision > 0) {
      setActiveTab('about');
    }
  }, [updater.promptRevision]);

  const renderPage = () => {
    switch (activeTab) {
      case 'dashboard':
        return (
          <ActiveAccount
            isEmailMaskingEnabled={isEmailMaskingEnabled}
            onNavigateToAccounts={() => setActiveTab('accounts')}
            usageRevision={usageScheduler.usageRevision}
            liveUsage={codexEvents.liveUsage}
            onRefreshUsage={codexEvents.refreshUsage}
            sessionMonitor={codexEvents.monitor}
            onRefreshSessions={codexEvents.refreshSessions}
            onViewLogs={() => setActiveTab('logs')}
          />
        );
      case 'accounts':
        return (
          <AccountList
            isEmailMaskingEnabled={isEmailMaskingEnabled}
            usageRevision={usageScheduler.usageRevision}
            onRefreshUsage={usageScheduler.refreshAccountUsage}
            isUsageRefreshing={usageScheduler.isUsageRefreshing}
          />
        );
      case 'settings':
        return <Settings />;
      case 'sessions':
        return <SessionsPage detailContainer={detailContainer} />;
      case 'token-usage':
        return <TokenUsagePage />;
      case 'mcp':
        return <MCPManager />;
      case 'skills':
        return <SkillManager />;
      case 'codex-info':
        return <CodexInfo />;
      case 'app-settings':
        return (
          <AppSettings
            appearance={appearance}
            onChangeAppearance={setAppearance}
            isEmailMaskingEnabled={isEmailMaskingEnabled}
            onToggleEmailMasking={toggleEmailMasking}
            isAutoLaunchEnabled={autostart.isEnabled}
            isAutoLaunchLoading={autostart.isLoading}
            isAutoLaunchReadOnly={autostart.isReadOnly}
            onToggleAutoLaunch={autostart.toggleAutostart}
            systemTray={systemTray}
          />
        );
      case 'logs':
        return <LogsPage />;
      case 'about':
        return <About updater={updater} />;
    }
  };

  return (
    <TooltipProvider delayDuration={150}>
      <div className="bento-window cursor-default select-none font-sans text-foreground">
        {/* 左侧侧边栏 */}
        <aside className="bento-sidebar-panel text-sidebar-foreground" aria-label="主导航侧边栏">
          {/* 顶部红绿灯拖拽区 + 品牌标题 */}
          <header data-tauri-drag-region className="sidebar-titlebar">
            <div data-tauri-drag-region className="sidebar-chrome" />

            <div data-tauri-drag-region className="mt-2.5 flex items-center gap-3 px-1">
              <Logo className="size-8 shrink-0 rounded-[9px]" />
              <div data-tauri-drag-region className="min-w-0 flex-1 leading-tight">
                <div data-tauri-drag-region className="flex items-center gap-1.5">
                  <h1
                    data-tauri-drag-region
                    className="truncate text-[15px] font-semibold tracking-[-0.015em] text-foreground select-none"
                  >
                    Codex Portal
                  </h1>
                  {appVersion && (
                    <ActionTooltip
                      side="bottom"
                      label={availableUpdate ? `发现新版本 v${availableUpdate}，点击查看` : '查看版本与更新'}
                    >
                      <button
                        type="button"
                        onClick={() => setActiveTab('about')}
                        className="button-neutral relative inline-flex h-[19px] shrink-0 cursor-pointer items-center gap-1 rounded-full px-1.5 font-mono text-[10.5px] leading-none text-muted-foreground transition-colors hover:text-foreground"
                      >
                        v{appVersion}
                        {availableUpdate && (
                          <span
                            className="bento-status-dot"
                            data-tone="error"
                            aria-label="有新版本"
                          />
                        )}
                      </button>
                    </ActionTooltip>
                  )}
                </div>
                <p data-tauri-drag-region className="mt-0.5 truncate text-[11.5px] text-[var(--label)] select-none">
                  账号与配置管理
                </p>
              </div>
            </div>
          </header>

          {/* 分组导航 */}
          <nav className="min-h-0 flex-1 space-y-3.5 overflow-y-auto px-4 pt-1 pb-2.5" aria-label="主导航">
            {NAV_GROUPS.map(group => (
              <div key={group.label}>
                <div className="sidebar-group-heading">{group.label}</div>
                <ul className="space-y-0.5">
                  {group.items.map(item => {
                    const isActive = activeTab === item.id;
                    return (
                      <li key={item.id}>
                        <button
                          type="button"
                          data-no-press
                          onClick={() => setActiveTab(item.id)}
                          aria-current={isActive ? 'page' : undefined}
                          data-selected={isActive || undefined}
                          className={cn(
                            'sidebar-nav-surface flex h-[38px] w-full cursor-pointer items-center gap-3 px-2.5 text-[14px] whitespace-nowrap outline-none focus-visible:ring-2 focus-visible:ring-ring/25',
                            isActive ? 'text-foreground' : 'text-foreground/80 hover:text-foreground',
                          )}
                        >
                          <span className="sidebar-nav-icon" aria-hidden="true">
                            <item.icon size={15} strokeWidth={1.9} />
                          </span>
                          <span className="truncate">{item.label}</span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </nav>

          {/* 底部当前账号速览 */}
          <div className="shrink-0 px-4 pb-3.5 pt-2">
            <SidebarAccountStatus
              isEmailMaskingEnabled={isEmailMaskingEnabled}
              usageRevision={usageScheduler.usageRevision}
              liveUsage={codexEvents.liveUsage}
              onOpenDashboard={() => setActiveTab('dashboard')}
              onOpenAccounts={() => setActiveTab('accounts')}
            />
          </div>
        </aside>

        {/* 右侧主工作区 */}
        <main className="bento-main">
          <div ref={setDetailContainer} className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
            <div className="flex min-h-0 flex-1 flex-col">{renderPage()}</div>
          </div>
        </main>
      </div>
      <UpdateModal updater={updater} />
      <Toaster />
    </TooltipProvider>
  );
}

export default App;
