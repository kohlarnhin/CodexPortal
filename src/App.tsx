import React, { useEffect, useState } from 'react';
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
import { TooltipProvider } from './components/ui/tooltip';
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
  icon: React.ReactNode;
}

const NAV_GROUPS: Array<{ label: string; items: NavItem[] }> = [
  {
    label: '账号',
    items: [
      { id: 'dashboard', label: '当前账号', icon: <><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="9" y1="21" x2="9" y2="9"/></> },
      { id: 'accounts', label: '账号管理', icon: <><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></> },
    ],
  },
  {
    label: 'Codex',
    items: [
      { id: 'sessions', label: '会话管理', icon: <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/> },
      { id: 'token-usage', label: 'Token 用量', icon: <><line x1="12" y1="20" x2="12" y2="10"/><line x1="18" y1="20" x2="18" y2="4"/><line x1="6" y1="20" x2="6" y2="16"/></> },
      { id: 'settings', label: '配置管理', icon: <><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></> },
      { id: 'mcp', label: 'MCP 配置', icon: <><path d="M12 22v-5"/><path d="M9 8V2"/><path d="M15 8V2"/><path d="M18 8v5a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V8Z"/></> },
      { id: 'skills', label: 'Skill 管理', icon: <><path d="m15 4 5 5L7 22l-5-5Z"/><path d="m14 5 5 5"/><path d="M6 13l5 5"/><path d="M19 2v3"/><path d="M22 5h-3"/></> },
      { id: 'codex-info', label: 'Codex 信息', icon: <><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></> },
    ],
  },
  {
    label: '应用',
    items: [
      { id: 'logs', label: '日志', icon: <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6M8 13h8M8 17h5"/></> },
      { id: 'app-settings', label: '设置', icon: <><line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/></> },
      { id: 'about', label: '关于', icon: <><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></> },
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
          <div className="flex items-center gap-2.5 px-5 pb-5">
            <Logo className="h-8 w-8 shrink-0 rounded-lg" />
            <div className="min-w-0 leading-tight">
              <h1 className="truncate text-[15px] font-semibold tracking-tight select-none">Codex Portal</h1>
              <p className="mt-0.5 truncate text-[12px] text-muted-foreground select-none">账号与配置管理</p>
            </div>
          </div>

          <nav className="flex-1 space-y-5 overflow-y-auto px-3 pb-4" aria-label="主导航">
            {NAV_GROUPS.map(group => (
              <div key={group.label}>
                <div className="px-3 pb-1.5 text-[12px] font-medium text-muted-foreground/80 select-none">
                  {group.label}
                </div>
                <ul className="space-y-1">
                  {group.items.map(item => {
                    const isActive = activeTab === item.id;
                    return (
                      <li key={item.id}>
                        <button
                          type="button"
                          onClick={() => setActiveTab(item.id)}
                          aria-current={isActive ? 'page' : undefined}
                          className={cn(
                            'flex h-9 w-full items-center gap-2.5 rounded-md px-3 text-[14px] whitespace-nowrap outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50 cursor-pointer',
                            isActive
                              ? 'bg-sidebar-accent font-medium text-sidebar-accent-foreground'
                              : 'text-sidebar-foreground/75 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground'
                          )}
                        >
                          <svg
                            xmlns="http://www.w3.org/2000/svg"
                            width="17"
                            height="17"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            className="shrink-0"
                            aria-hidden="true"
                          >
                            {item.icon}
                          </svg>
                          <span className="truncate">{item.label}</span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </nav>
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
    </TooltipProvider>
  );
}

export default App;
