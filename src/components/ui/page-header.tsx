import * as React from 'react';
import { cn } from '../../lib/utils';

interface PageHeaderProps {
  title: React.ReactNode;
  description?: React.ReactNode;
  /** 标题右侧的附加内容（如状态徽标） */
  badge?: React.ReactNode;
  /** 右侧操作区 */
  actions?: React.ReactNode;
  className?: string;
}

/** 统一的页面标题栏：标题 + 描述 + 右侧操作区。 */
export function PageHeader({ title, description, badge, actions, className }: PageHeaderProps) {
  return (
    <div className={cn('page-header', className)}>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-heading font-semibold leading-7 tracking-tight text-foreground">{title}</h2>
          {badge}
        </div>
        {description && <p className="mt-1 text-body text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export default PageHeader;
