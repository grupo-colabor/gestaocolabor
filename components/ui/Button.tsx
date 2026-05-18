import React from 'react';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
type Size = 'sm' | 'md';

interface ButtonProps {
  variant?: Variant;
  size?: Size;
  icon?: any;
  children?: any;
  style?: object;
  disabled?: boolean;
  onClick?: (e: any) => void;
  type?: 'button' | 'submit' | 'reset';
  title?: string;
  className?: string;
  [key: string]: any;
}

const STYLES: Record<Variant, object> = {
  primary:   { background: '#2563EB', color: '#FFFFFF', border: 'none' },
  secondary: { background: 'var(--brand-50)', color: '#3730A3', border: '0.5px solid var(--brand-100)' },
  ghost:     { background: 'transparent', color: 'var(--text-secondary)', border: '0.5px solid var(--border-subtle)' },
  danger:    { background: '#FEF2F2', color: '#991B1B', border: '0.5px solid #FECACA' },
};

const SIZES: Record<Size, object> = {
  sm: { padding: '5px 10px', fontSize: '12px' },
  md: { padding: '7px 14px', fontSize: '13px' },
};

export function Button({ variant = 'primary', size = 'md', icon, children, style, disabled, ...props }: ButtonProps) {
  return (
    <button
      {...props}
      disabled={disabled}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '6px',
        borderRadius: 'var(--radius-btn)',
        fontWeight: 500,
        cursor: disabled ? 'not-allowed' : 'pointer',
        fontFamily: 'inherit',
        transition: 'opacity .15s',
        opacity: disabled ? 0.5 : 1,
        ...STYLES[variant],
        ...SIZES[size],
        ...style,
      }}
    >
      {icon && <span style={{ fontSize: '14px', display: 'flex' }}>{icon}</span>}
      {children}
    </button>
  );
}
