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
          <svg aria-hidden="true" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m9 18 6-6-6-6" /></svg>
        </Button>
      </DialogTrigger>

      <DialogContent className="flex max-h-[85vh] w-[calc(100vw-2rem)] max-w-2xl flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="shrink-0 border-b border-border px-6 py-5 pr-12">
          <DialogTitle>模型价格</DialogTitle>
          <DialogDescription>
            API 标准短上下文单价 · 美元 / 百万 tokens
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-auto overscroll-contain">
          <table className="w-full text-[12.5px]">
            <caption className="sr-only">当前 {pricingEntries.length} 个内置模型的单价和计费倍率</caption>
            <thead className="sticky top-0 bg-muted/40 text-[11.5px] text-muted-foreground">
              <tr>
                <th scope="col" className="whitespace-nowrap px-6 py-3 text-left font-medium">模型</th>
                <th scope="col" className="whitespace-nowrap px-4 py-3 text-right font-medium">输入</th>
                <th scope="col" className="whitespace-nowrap px-4 py-3 text-right font-medium">缓存输入</th>
                <th scope="col" className="whitespace-nowrap px-4 py-3 text-right font-medium">输出</th>
                <th scope="col" className="whitespace-nowrap py-3 pl-4 pr-6 text-right font-medium">计费倍率</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {pricingEntries.map(([model, pricing]) => (
                <tr key={model} className="transition-colors hover:bg-muted/50">
                  <th scope="row" className="whitespace-nowrap px-6 py-3 text-left font-mono font-medium text-foreground">{model}</th>
                  <td className="whitespace-nowrap px-4 py-3 text-right font-mono tabular-nums text-muted-foreground">{priceFormatter.format(pricing.inputPer1M)}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-right font-mono tabular-nums text-muted-foreground">{priceFormatter.format(pricing.cachedInputPer1M)}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-right font-mono tabular-nums text-muted-foreground">{priceFormatter.format(pricing.outputPer1M)}</td>
                  <td className="py-3 pl-4 pr-6 text-right">
                    <span className={`inline-flex rounded-md px-2 py-0.5 font-mono text-[11.5px] tabular-nums ${
                      (pricing.costMultiplier ?? 1) === 1 ? 'text-muted-foreground' : 'bg-neutral-900 text-white'
                    }`}>
                      ×{pricing.costMultiplier ?? 1}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="shrink-0 border-t border-border bg-muted/40 px-6 py-4">
          <p className="text-[12px] leading-relaxed text-muted-foreground">
            预估费用按表中单价计算后，再乘以对应倍率。
          </p>
          <DialogFooter className="pt-3">
            <span className="mr-auto text-[11.5px] text-muted-foreground">共 {pricingEntries.length} 个内置模型</span>
            <DialogClose asChild>
              <Button type="button" size="sm">关闭</Button>
            </DialogClose>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}
