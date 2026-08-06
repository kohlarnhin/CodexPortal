import React from 'react';

export default function SkillManager() {
  return (
    <div className="max-w-4xl mx-auto w-full h-full flex flex-col pt-4">
      <div className="flex items-center justify-between mb-4 shrink-0">
        <div>
          <h2 className="text-[20px] font-semibold tracking-tight text-black mb-1">Skill 管理</h2>
          <p className="text-[13px] text-[#666666]">管理 Codex Skills 与扩展能力</p>
        </div>
      </div>

      <div className="flex-1 min-h-0 flex flex-col pb-4">
        <div className="bg-white rounded-xl shadow-sm border border-[#EAEAEA] flex-1 min-h-0 flex flex-col items-center justify-center px-8 text-center">
          <div className="w-16 h-16 bg-[#F5F5F5] rounded-xl flex items-center justify-center border border-[#EAEAEA] mb-5">
            <svg xmlns="http://www.w3.org/2000/svg" width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="m15 4 5 5L7 22l-5-5Z" />
              <path d="m14 5 5 5" />
              <path d="M6 13l5 5" />
              <path d="M19 2v3" />
              <path d="M22 5h-3" />
            </svg>
          </div>
          <h3 className="text-[20px] font-semibold tracking-tight text-black mb-2">功能开发中！</h3>
          <p className="text-[13px] text-[#888888]">Skill 管理能力将在后续版本中开放。</p>
        </div>
      </div>
    </div>
  );
}
