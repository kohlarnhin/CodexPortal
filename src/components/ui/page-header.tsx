import * as React from 'react';
import { cn } from '../../lib/utils';

interface PageHeaderProps {
  title: React.ReactNode;
  description?: React.ReactNode;
  /** 标题右侧的附加内容（如状态点与同步说明） */
  badge?: React.ReactNode;
  /** 中间区域（可选，如分段切换控件） */
  center?: React.ReactNode;
  /** 右侧操作区 */
  actions?: React.ReactNode;
  className?: string;
}

/** Bento 风格顶栏：同时作为主面板顶部窗口拖拽区，左侧标题 + 状态，右侧胶囊操作。 */
export function PageHeader({ title, description, badge, center, actions, className }: PageHeaderProps) {
  return (
    <header data-tauri-drag-region className={cn('page-header', className)}>
      <div data-tauri-drag-region className="min-w-0">
        <div data-tauri-drag-region className="flex flex-wrap items-center gap-2.5">
          <h2
            data-tauri-drag-region
            className="text-heading font-semibold leading-6 tracking-[-0.015em] text-foreground select-none"
          >
            {title}
          </h2>
          {badge}
        </div>
        {description && (
          <p data-tauri-drag-region className="mt-1 text-label text-muted-foreground leading-snug">
            {description}
          </p>
        )}
      </div>
      {center && <div className="no-drag flex shrink-0 items-center">{center}</div>}
      {actions && <div className="no-drag flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

export default PageHeader;
