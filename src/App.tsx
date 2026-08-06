import React, { useState } from 'react';
import AccountList from './components/AccountList';
import Settings from './components/Settings';
import ActiveAccount from './components/ActiveAccount';
import MCPManager from './components/MCPManager';
import SkillManager from './components/SkillManager';
import CodexInfo from './components/CodexInfo';
import About from './components/About';
import UpdateModal from './components/UpdateModal';
import Logo from './components/Logo';
import { useUpdater } from './hooks/useUpdater';
import { useEmailMasking } from './hooks/useEmailMasking';
import { useAccountUsageScheduler } from './hooks/useAccountUsageScheduler';

function App() {
  const [activeTab, setActiveTab] = useState('dashboard');
  const updater = useUpdater();
  const { isEmailMaskingEnabled, toggleEmailMasking } = useEmailMasking();
  const usageScheduler = useAccountUsageScheduler();

  return (
    <>
      <div className="flex h-screen bg-[#FAFAFA] text-[#111111] font-sans overflow-hidden cursor-default relative">
      {/* Sidebar */}
      <div className="w-[240px] flex-shrink-0 bg-[#F9F9F9] border-r border-[#EAEAEA] flex flex-col">
        {/* Sidebar Drag Header (Traffic Lights area) */}
        <div data-tauri-drag-region className="h-10 w-full shrink-0"></div>
        <div className="px-5 pb-8">
          <div className="flex items-center gap-3 pointer-events-none">
            <Logo className="w-7 h-7 shadow-sm" />
            <h1 className="font-semibold text-[16px] tracking-tight">Codex Portal</h1>
          </div>
        </div>

        <nav className="flex-1 px-4 py-2 space-y-2 overflow-y-auto">
          <button
            onClick={() => setActiveTab('dashboard')}
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-colors text-[15px] ${
              activeTab === 'dashboard' 
                ? 'bg-black/[0.06] text-black font-semibold' 
                : 'text-[#666666] hover:bg-black/[0.03] hover:text-black font-medium'
            }`}
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="9" y1="21" x2="9" y2="9"/></svg>
            当前账号
          </button>

          <button
            onClick={() => setActiveTab('accounts')}
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-colors text-[15px] ${
              activeTab === 'accounts' 
                ? 'bg-black/[0.06] text-black font-semibold' 
                : 'text-[#666666] hover:bg-black/[0.03] hover:text-black font-medium'
            }`}
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
            账号管理
          </button>

          <button
            onClick={() => setActiveTab('settings')}
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-colors text-[15px] ${
              activeTab === 'settings' 
                ? 'bg-black/[0.06] text-black font-semibold' 
                : 'text-[#666666] hover:bg-black/[0.03] hover:text-black font-medium'
            }`}
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg>
            配置管理
          </button>

          <button
            onClick={() => setActiveTab('mcp')}
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-colors text-[15px] ${
              activeTab === 'mcp' 
                ? 'bg-black/[0.06] text-black font-semibold' 
                : 'text-[#666666] hover:bg-black/[0.03] hover:text-black font-medium'
            }`}
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>
            MCP 配置
          </button>

          <button
            onClick={() => setActiveTab('skills')}
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-colors text-[15px] ${
              activeTab === 'skills'
                ? 'bg-black/[0.06] text-black font-semibold'
                : 'text-[#666666] hover:bg-black/[0.03] hover:text-black font-medium'
            }`}
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="m15 4 5 5L7 22l-5-5Z"/><path d="m14 5 5 5"/><path d="M6 13l5 5"/><path d="M19 2v3"/><path d="M22 5h-3"/></svg>
            Skill 管理
          </button>

          <button
            onClick={() => setActiveTab('codex-info')}
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-colors text-[15px] ${
              activeTab === 'codex-info' 
                ? 'bg-black/[0.06] text-black font-semibold' 
                : 'text-[#666666] hover:bg-black/[0.03] hover:text-black font-medium'
            }`}
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg>
            Codex 信息
          </button>

          <button
            onClick={() => setActiveTab('about')}
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg transition-colors text-[15px] ${
              activeTab === 'about' 
                ? 'bg-black/[0.06] text-black font-semibold' 
                : 'text-[#666666] hover:bg-black/[0.03] hover:text-black font-medium'
            }`}
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>
            关于
          </button>
        </nav>

        <div className="px-4 pb-5 shrink-0">
          <button
            type="button"
            role="switch"
            aria-checked={isEmailMaskingEnabled}
            onClick={toggleEmailMasking}
            title="控制当前账号与账号管理列表中的邮箱是否脱敏"
            className="w-full flex items-center justify-between gap-3 px-3.5 py-3 bg-white border border-[#EAEAEA] rounded-lg hover:border-[#D0D0D0] hover:shadow-sm transition-all"
          >
            <span className="flex items-center gap-2.5 min-w-0 text-left">
              <span className="w-7 h-7 shrink-0 rounded-md bg-[#F5F5F5] border border-[#EAEAEA] flex items-center justify-center text-[#555555]">
                {isEmailMaskingEnabled ? (
                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 11V8a9 9 0 0 1 18 0v3"/><path d="M5 11h14v10H5z"/><path d="M12 15v2"/></svg>
                ) : (
                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></svg>
                )}
              </span>
              <span className="min-w-0">
                <span className="block text-[13px] font-medium text-black leading-tight">邮箱脱敏</span>
                <span className="block text-[10px] text-[#888888] mt-0.5">
                  {isEmailMaskingEnabled ? '隐私保护已开启' : '正在显示原邮箱'}
                </span>
              </span>
            </span>
            <span className={`relative w-9 h-5 shrink-0 rounded-full transition-colors ${
              isEmailMaskingEnabled ? 'bg-black' : 'bg-[#D8D8D8]'
            }`}>
              <span className={`absolute top-[2px] left-[2px] w-4 h-4 bg-white rounded-full shadow-sm transition-transform ${
                isEmailMaskingEnabled ? 'translate-x-4' : 'translate-x-0'
              }`} />
            </span>
          </button>
        </div>
      </div>

      {/* Content Area */}
      <div className="flex-1 flex flex-col min-w-0 bg-[#FAFAFA]">
        {/* Main Content Drag Header */}
        <div data-tauri-drag-region className="h-10 shrink-0 w-full"></div>
        <div className="flex-1 flex flex-col relative px-12 pb-12 overflow-hidden">
          {activeTab === 'dashboard' && (
            <div className="flex-1 flex flex-col min-h-0">
              <ActiveAccount
                isEmailMaskingEnabled={isEmailMaskingEnabled}
                onNavigateToAccounts={() => setActiveTab('accounts')}
                usageRevision={usageScheduler.usageRevision}
                onRefreshUsage={usageScheduler.refreshAccountUsage}
                isUsageRefreshing={usageScheduler.isUsageRefreshing}
              />
            </div>
          )}
          {activeTab === 'accounts' && (
            <div className="flex-1 overflow-y-auto -mr-4 pr-4">
              <AccountList
                isEmailMaskingEnabled={isEmailMaskingEnabled}
                usageRevision={usageScheduler.usageRevision}
                onRefreshUsage={usageScheduler.refreshAccountUsage}
                isUsageRefreshing={usageScheduler.isUsageRefreshing}
              />
            </div>
          )}
          {activeTab === 'settings' && (
            <div className="flex-1 flex flex-col min-h-0">
              <Settings />
            </div>
          )}
          {activeTab === 'mcp' && (
            <div className="flex-1 flex flex-col min-h-0">
              <MCPManager />
            </div>
          )}
          {activeTab === 'skills' && (
            <div className="flex-1 flex flex-col min-h-0">
              <SkillManager />
            </div>
          )}
          {activeTab === 'codex-info' && (
            <div className="flex-1 flex flex-col min-h-0">
              <CodexInfo />
            </div>
          )}
          {activeTab === 'about' && (
            <div className="flex-1 flex flex-col min-h-0">
              <About updater={updater} />
            </div>
          )}
        </div>
      </div>
      </div>
      <UpdateModal updater={updater} />
    </>
  );
}

export default App;
