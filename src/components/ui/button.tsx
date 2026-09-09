import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../../lib/utils';

export const buttonVariants = cva(
  'inline-flex items-center justify-center gap-1.5 whitespace-nowrap font-medium transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black/20 focus-visible:ring-offset-1 disabled:pointer-events-none disabled:opacity-50 select-none cursor-pointer active:scale-[0.98]',
  {
    variants: {
      variant: {
        default:
          'bg-black text-white hover:bg-[#2A2A2A] shadow-sm',
        destructive:
          'bg-[#DC2626] text-white hover:bg-[#B91C1C] shadow-sm',
        outline:
          'border border-[#E5E5E5] bg-white text-black hover:bg-[#F5F5F5] hover:border-[#D4D4D4] shadow-2xs',
        secondary:
          'bg-[#F5F5F5] text-black hover:bg-[#EAEAEA] shadow-2xs',
        ghost:
          'text-[#666666] hover:bg-[#F5F5F5] hover:text-black',
        link:
          'text-black underline-offset-4 hover:underline',
      },
      size: {
        default: 'h-9 px-4 py-2 text-[13px] rounded-lg',
        sm: 'h-8 px-3 text-[12px] rounded-md',
        lg: 'h-10 px-6 text-[14px] rounded-lg',
        icon: 'h-8 w-8 rounded-lg p-0',
        'icon-sm': 'h-7 w-7 rounded-md p-0',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button';
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    );
  }
);
Button.displayName = 'Button';

export default Button;
