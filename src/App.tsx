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
            isEmailMaskingEnabled={isEmailMaskingEnabled}
            onToggleEmailMasking={toggleEmailMasking}
            isAutoLaunchEnabled={autostart.isEnabled}
            isAutoLaunchLoading={autostart.isLoading}
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
      <div className="relative flex h-screen cursor-default overflow-hidden bg-background font-sans text-foreground">
        {/* Sidebar */}
        <aside className="flex w-[240px] shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground">
          {/* Sidebar Drag Header (Traffic Lights area) */}
          <div data-tauri-drag-region className="h-10 w-full shrink-0" />
          <div className="flex items-center gap-2.5 px-5 pb-6">
            <Logo className="h-8 w-8 shrink-0 rounded-lg" />
            <div className="min-w-0 flex-1 leading-tight">
              <div className="flex min-w-0 items-center gap-1.5">
                <h1 className="truncate text-title font-semibold tracking-tight select-none">Codex Portal</h1>
                {appVersion && (
                  <ActionTooltip label={availableUpdate ? `发现新版本 v${availableUpdate}，点击查看` : '查看版本信息'}>
                    <button
                      type="button"
                      onClick={() => setActiveTab('about')}
                      className="relative inline-flex h-[18px] shrink-0 cursor-pointer items-center rounded-full border bg-background px-1.5 font-mono text-caption leading-none text-muted-foreground transition-colors hover:text-foreground"
                    >
                      v{appVersion}
                      {availableUpdate && (
                        <span className="absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full bg-destructive ring-2 ring-sidebar" aria-label="有新版本" />
                      )}
                    </button>
                  </ActionTooltip>
                )}
              </div>
              <p className="mt-0.5 truncate text-label text-muted-foreground select-none">账号与配置管理</p>
            </div>
          </div>

          <nav className="flex-1 space-y-6 overflow-y-auto px-3 pb-4" aria-label="主导航">
            {NAV_GROUPS.map(group => (
              <div key={group.label}>
                <div className="px-3 pb-2 text-caption font-medium tracking-wide text-muted-foreground/70 select-none">
                  {group.label}
                </div>
                <ul className="space-y-0.5">
                  {group.items.map(item => {
                    const isActive = activeTab === item.id;
                    return (
                      <li key={item.id}>
                        <button
                          type="button"
                          onClick={() => setActiveTab(item.id)}
                          aria-current={isActive ? 'page' : undefined}
                          className={cn(
                            'flex h-[34px] w-full items-center gap-2.5 rounded-md px-3 text-subtitle whitespace-nowrap outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50 cursor-pointer',
                            isActive
                              ? 'bg-sidebar-accent font-medium text-sidebar-accent-foreground'
                              : 'text-sidebar-foreground/75 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground'
                          )}
                        >
                          <item.icon size={16} className="shrink-0" aria-hidden="true" />
                          <span className="truncate">{item.label}</span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </nav>

          <div className="shrink-0 border-t border-sidebar-border px-3 pt-3 pb-3">
            <SidebarAccountStatus
              isEmailMaskingEnabled={isEmailMaskingEnabled}
              usageRevision={usageScheduler.usageRevision}
              liveUsage={codexEvents.liveUsage}
              onOpenDashboard={() => setActiveTab('dashboard')}
              onOpenAccounts={() => setActiveTab('accounts')}
            />
          </div>
        </aside>

        {/* Content Area */}
        <main className="flex min-w-0 flex-1 flex-col bg-background">
          {/* Main Content Drag Header */}
          <div data-tauri-drag-region className="h-10 w-full shrink-0" />
          <div ref={setDetailContainer} className="relative flex flex-1 flex-col overflow-hidden px-8 pb-6">
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
