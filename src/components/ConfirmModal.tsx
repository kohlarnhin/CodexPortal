import React from 'react';

interface ConfirmModalProps {
  isOpen: boolean;
  title: string;
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
}

const ConfirmModal: React.FC<ConfirmModalProps> = ({ isOpen, title, message, onConfirm, onCancel }) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/20 backdrop-blur-sm animate-fade-in">
      <div className="bg-white rounded-xl shadow-2xl border border-[#EAEAEA] w-full max-w-sm overflow-hidden animate-modal-in">
        <div className="px-5 py-4 border-b border-[#EAEAEA]">
          <h3 className="font-semibold text-[15px] text-black tracking-tight">{title}</h3>
        </div>
        <div className="p-5">
          <p className="text-[13px] text-[#666666] leading-relaxed">{message}</p>
        </div>
        <div className="px-5 py-3 bg-[#FAFAFA] border-t border-[#EAEAEA] flex items-center justify-end gap-2">
          <button 
            onClick={onCancel}
            className="px-4 py-1.5 text-[13px] font-medium text-[#666666] hover:bg-[#F5F5F5] hover:text-black rounded-md transition-colors"
          >
            取消
          </button>
          <button 
            onClick={onConfirm}
            className="px-4 py-1.5 bg-[#D32F2F] hover:bg-[#B71C1C] text-white text-[13px] font-medium rounded-md transition-colors shadow-sm"
          >
            确认删除
          </button>
        </div>
      </div>
    </div>
  );
};

export default ConfirmModal;
