import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../../lib/utils';

export const buttonVariants = cva(
  'inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-full font-medium transition-[color,background-color,box-shadow,opacity,scale] duration-150 outline-none focus-visible:ring-2 focus-visible:ring-ring/25 disabled:pointer-events-none disabled:opacity-45 select-none cursor-pointer [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        default:
          'bg-primary text-primary-foreground hover:bg-[var(--primary-hover)]',
        destructive:
          'bg-destructive text-white hover:opacity-90',
        outline:
          'button-neutral',
        secondary:
          'button-neutral',
        ghost:
          'text-muted-foreground hover:bg-[var(--hover)] hover:text-foreground',
        link:
          'rounded-md text-foreground underline-offset-4 hover:underline',
      },
      size: {
        default: 'h-9 px-4 text-[13px]',
        sm: 'h-8 px-3.5 text-[12.5px]',
        lg: 'h-10 px-5 text-[13.5px]',
        icon: 'size-8 p-0',
        'icon-sm': 'size-7 p-0',
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
