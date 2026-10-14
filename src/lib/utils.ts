import { clsx, type ClassValue } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

// 自定义字号阶梯（index.css 的 --text-*）需告知 tailwind-merge，否则会被当成文字颜色与 text-foreground 等互相覆盖。
const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      text: ['caption', 'label', 'body', 'subtitle', 'title', 'heading', 'stat'],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
