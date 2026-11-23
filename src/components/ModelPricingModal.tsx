import { MODEL_PRICING } from '../utils/modelPricing';
import Button from './ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from './ui/dialog';
import { ChevronRight } from 'lucide-react';

const pricingEntries = Object.entries(MODEL_PRICING);
const priceFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 6,
});

export default function ModelPricingModal() {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size="sm" className="shrink-0">
          查看价格
          <ChevronRight aria-hidden="true" size={13} />
        </Button>
      </DialogTrigger>

      <DialogContent className="flex max-h-[85vh] w-[calc(100vw-3rem)] max-w-2xl flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="shrink-0 border-b border-[var(--hairline-divider)] px-6 py-4 pr-14">
          <DialogTitle>模型价格</DialogTitle>
          <DialogDescription>
            API 标准短上下文单价 · 美元 / 百万 tokens
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-auto overscroll-contain">
          <table className="w-full text-body">
            <caption className="sr-only">当前 {pricingEntries.length} 个内置模型的单价和计费倍率</caption>
            <thead className="sticky top-0 bg-[var(--surface)] text-caption text-[var(--label)] shadow-[inset_0_-1px_0_var(--hairline-divider)]">
              <tr>
                <th scope="col" className="whitespace-nowrap px-6 py-3 text-left font-medium">模型</th>
                <th scope="col" className="whitespace-nowrap px-4 py-3 text-right font-medium">输入</th>
                <th scope="col" className="whitespace-nowrap px-4 py-3 text-right font-medium">缓存输入</th>
                <th scope="col" className="whitespace-nowrap px-4 py-3 text-right font-medium">输出</th>
                <th scope="col" className="whitespace-nowrap py-3 pl-4 pr-6 text-right font-medium">计费倍率</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--hairline-divider)]">
              {pricingEntries.map(([model, pricing]) => (
                <tr key={model} className="transition-colors hover:bg-[var(--hover)]">
                  <th scope="row" className="whitespace-nowrap px-6 py-3 text-left font-mono font-medium text-foreground">
                    {model}
                  </th>
                  <td className="whitespace-nowrap px-4 py-3 text-right font-mono text-muted-foreground tabular-nums">
                    {priceFormatter.format(pricing.inputPer1M)}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-right font-mono text-muted-foreground tabular-nums">
                    {priceFormatter.format(pricing.cachedInputPer1M)}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-right font-mono text-muted-foreground tabular-nums">
                    {priceFormatter.format(pricing.outputPer1M)}
                  </td>
                  <td className="py-3 pl-4 pr-6 text-right">
                    <span
                      className={`inline-flex rounded-full px-2 py-0.5 font-mono text-caption tabular-nums ${
                        (pricing.costMultiplier ?? 1) === 1
                          ? 'text-[var(--label)]'
                          : 'bg-primary text-primary-foreground'
                      }`}
                    >
                      ×{pricing.costMultiplier ?? 1}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="shrink-0 border-t border-[var(--hairline-divider)] px-6 py-3.5">
          <DialogFooter className="pt-0">
            <span className="mr-auto text-caption text-[var(--label)]">
              共 {pricingEntries.length} 个内置模型 · 预估费用按单价乘以对应倍率计算
            </span>
            <DialogClose asChild>
              <Button type="button" size="sm">关闭</Button>
            </DialogClose>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}
