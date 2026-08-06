import React, { useState, useEffect } from 'react';
import { getVersion, getName, getTauriVersion } from '@tauri-apps/api/app';
import Logo from './Logo';

export default function About() {
  const [appVersion, setAppVersion] = useState<string>('...');
  const [appName, setAppName] = useState<string>('...');
  const [tauriVersion, setTauriVersion] = useState<string>('...');

  useEffect(() => {
    const fetchAppInfo = async () => {
      try {
        const v = await getVersion();
        const n = await getName();
        const t = await getTauriVersion();
        setAppVersion(v);
        setAppName(n);
        setTauriVersion(t);
      } catch (err) {
        console.error('Failed to load app info:', err);
      }
    };
    
    fetchAppInfo();
  }, []);

  return (
    <div className="max-w-4xl mx-auto w-full h-full flex flex-col pt-4">
      <div className="flex items-center justify-between mb-4 shrink-0">
        <div>
          <h2 className="text-[20px] font-semibold tracking-tight text-black mb-1">关于</h2>
          <p className="text-[13px] text-[#666666]">关于 Codex Portal 应用程序</p>
        </div>
      </div>

      <div className="flex-1 min-h-0 flex flex-col pb-4">
        <div className="bg-white rounded-xl shadow-sm border border-[#EAEAEA] flex flex-col items-center justify-center py-10 text-center flex-1">
          
          <div className="mb-4">
            <Logo className="w-16 h-16 shadow-md rounded-2xl" />
          </div>
          
          <h1 className="text-[28px] font-black text-black tracking-tighter mb-2">{appName}</h1>
          <p className="text-[14px] text-[#666666] mb-6 max-w-md mx-auto">
            强大而优雅的 Codex 模型管理入口，帮助你轻松管理多种账户与本地环境配置。
          </p>

          <div className="bg-[#F9F9F9] border border-[#EAEAEA] rounded-lg p-5 w-full max-w-sm text-left mx-auto">
            <div className="flex justify-between items-center py-2.5 border-b border-[#EAEAEA]">
              <span className="text-[13px] font-medium text-[#666666]">应用程序版本</span>
              <span className="text-[14px] font-bold text-black">{appVersion}</span>
            </div>
            <div className="flex justify-between items-center py-2.5">
              <span className="text-[13px] font-medium text-[#666666]">Tauri 核心版本</span>
              <span className="text-[14px] font-bold text-black">{tauriVersion}</span>
            </div>
          </div>
          
          <div className="mt-8 text-[12px] text-[#999999]">
            © {new Date().getFullYear()} Codex Portal. All rights reserved.
          </div>
        </div>
      </div>
    </div>
  );
}
