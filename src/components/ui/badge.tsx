import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../../lib/utils';

export const badgeVariants = cva(
  'inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-black focus:ring-offset-2',
  {
    variants: {
      variant: {
        default:
          'border-transparent bg-black text-white hover:bg-black/80',
        secondary:
          'border-transparent bg-[#F5F5F5] text-black hover:bg-[#EAEAEA]',
        destructive:
          'border-transparent bg-[#DC2626] text-white hover:bg-[#B91C1C]',
        outline:
          'border-[#E5E5E5] text-black bg-white',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <div className={cn(badgeVariants({ variant }), className)} {...props} />
  );
}

export default Badge;
