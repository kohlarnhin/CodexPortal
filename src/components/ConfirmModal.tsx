import React from 'react';
import Button from './ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from './ui/dialog';

interface ConfirmModalProps {
  isOpen: boolean;
  title: string;
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
}

const ConfirmModal: React.FC<ConfirmModalProps> = ({ isOpen, title, message, onConfirm, onCancel }) => {
  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!open) onCancel(); }}>
      <DialogContent className="max-w-sm p-6 gap-4" showCloseButton={false}>
        <DialogHeader className="pr-0">
          <DialogTitle className="text-[16px] font-semibold text-neutral-900">{title}</DialogTitle>
          <DialogDescription className="text-[13px] text-neutral-600 leading-relaxed pt-1">
            {message}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2.5 pt-2">
          <Button 
            variant="outline"
            size="sm"
            onClick={onCancel}
          >
            取消
          </Button>
          <Button 
            variant="destructive"
            size="sm"
            onClick={onConfirm}
          >
            确认删除
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default ConfirmModal;

