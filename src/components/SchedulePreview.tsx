import { useScheduleStatus } from '../hooks/useScheduleStatus';
import { Account } from '../types/account';
import { getDisplayedEmail } from '../utils/accountEmail';
import { cn } from '../lib/utils';

function formatTime(timestamp: number) {
  const time = new Date(timestamp * 1000);
  const clock = time.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });
  return time.toDateString() === new Date().toDateString()
    ? clock : `${time.getMonth() + 1}/${time.getDate()} ${clock}`;
}

export default function SchedulePreview({ accounts, isEmailMaskingEnabled, className }: {
  accounts: Account[];
  isEmailMaskingEnabled: boolean;
  className?: string;
}) {
  const { status, unavailable } = useScheduleStatus();
  let detail = '正在读取…';
  if (unavailable) {
    detail = '状态暂不可用';
  } else if (status?.allExhausted) {
    detail = status.earliestRecoveryAt !== null
      ? `所有账号额度已用完，最早 ${formatTime(status.earliestRecoveryAt)} 恢复`
      : '所有账号额度已用完';
  } else if (status?.next) {
    const account = accounts.find((account) => account.id === status.next?.id);
    const name = account ? getDisplayedEmail(account.name, isEmailMaskingEnabled) : '订阅账号';
    detail = !status.current?.usable ? `即将使用 ${name}`
      : status.current.resetsAt !== null ? `预计 ${formatTime(status.current.resetsAt)} 后切换到 ${name}`
      : `当前额度用完后切换到 ${name}`;
  } else if (status) {
    detail = status.current?.usable ? '使用当前账号，暂无接替账号' : '无可用订阅账号';
  }
  const text = `智能调度 · ${detail}`;
  return <p role="status" title={text} className={cn('min-w-0 truncate text-label text-muted-foreground', className)}>{text}</p>;
}
