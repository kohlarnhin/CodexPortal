import React, { useState } from 'react';
import { Account } from '../types/account';

interface AccountCardProps {
  account: Account;
  isActive: boolean;
  onSetActive: (id: string) => void;
  onEdit: (account: Account) => void;
  onDelete: (id: string) => void;
}

const AccountCard: React.FC<AccountCardProps> = ({ account, isActive, onSetActive, onEdit, onDelete }) => {
  return (
    <div className={`snap-start flex flex-col relative bg-white rounded-xl border-2 transition-all duration-200 ${
      isActive ? 'border-black' : 'border-[#EAEAEA] hover:border-[#D0D0D0]'
    }`}>
      <div className="p-5 flex-1 flex flex-col">
        <div className="flex items-start justify-between mb-4">
          <div>
            <div className="flex items-center gap-2 mb-1.5">
              <h3 className="text-[16px] font-bold text-black leading-tight">{account.name}</h3>
              <span className="px-1.5 py-0.5 bg-[#F5F5F5] text-[#666666] border border-[#EAEAEA] text-[9px] font-bold rounded uppercase tracking-wider">
                {account.planType === 'monthly' ? '月限' : '周限'}
              </span>
            </div>
          </div>
          
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-1.5">
              <button 
                onClick={() => onEdit(account)} 
                title="编辑账号"
                className="w-7 h-7 flex items-center justify-center rounded text-[#888888] hover:bg-[#F5F5F5] hover:text-black transition-all"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>
              </button>
              <button 
                onClick={() => onDelete(account.id)} 
                title="删除账号"
                className="w-7 h-7 flex items-center justify-center rounded text-[#888888] hover:bg-[#FFF0F0] hover:text-[#D32F2F] transition-all"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>
              </button>
            </div>
            <div className="w-[1px] h-4 bg-[#EAEAEA]"></div>
            <div className="flex items-center gap-2">
              <div 
                onClick={() => {
                  if (!isActive) onSetActive(account.id);
                }}
                className={`relative inline-block w-10 h-5 rounded-full transition-colors duration-200 ease-in-out cursor-pointer ${
                  isActive ? 'bg-black' : 'bg-[#E0E0E0] hover:bg-[#D0D0D0]'
                }`}
              >
                <span className={`absolute left-[2px] top-[2px] bg-white w-4 h-4 rounded-full shadow-sm transform transition-transform duration-200 ease-in-out ${
                  isActive ? 'translate-x-5' : 'translate-x-0'
                }`} />
              </div>
            </div>
          </div>
        </div>
        
        <div className="flex items-center justify-between pt-4 border-t border-[#EAEAEA] mt-auto">
          <div className="flex items-center gap-2 overflow-hidden mr-4">
            {account.notes && (
              <>
                <div className="w-5 h-5 shrink-0 rounded bg-[#F5F5F5] flex items-center justify-center border border-[#EAEAEA]">
                  <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-[#999999]"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><line x1="10" y1="9" x2="8" y2="9"/></svg>
                </div>
                <p className="text-[12px] text-[#666666] truncate">
                  {account.notes}
                </p>
              </>
            )}
          </div>
          <span className="text-[11px] text-[#999999] shrink-0 font-mono">
            更新于: {new Date(account.updatedAt).toLocaleDateString()}
          </span>
        </div>
      </div>
    </div>
  );
};

export default AccountCard;
