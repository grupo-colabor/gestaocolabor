import React from 'react';

interface InputProps {
  label?: string;
  id?: string;
  style?: object;
  onFocus?: (e: any) => void;
  onBlur?: (e: any) => void;
  [key: string]: any;
}

export function Input({ label, id, style, onFocus, onBlur, ...props }: InputProps) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
      {label && (
        <label htmlFor={id} style={{ fontSize: '12px', fontWeight: 500, color: 'var(--text-secondary)' }}>
          {label}
        </label>
      )}
      <input
        id={id}
        {...props}
        style={{
          width: '100%',
          padding: '9px 12px',
          borderRadius: 'var(--radius-input)',
          border: '0.5px solid var(--border-default)',
          background: 'var(--surface-0)',
          color: 'var(--text-primary)',
          fontSize: '14px',
          fontFamily: 'inherit',
          outline: 'none',
          transition: 'border-color .15s, box-shadow .15s',
          ...style,
        }}
        onFocus={(e: any) => {
          e.currentTarget.style.borderColor = '#2563EB';
          e.currentTarget.style.boxShadow = '0 0 0 3px rgba(37,99,235,0.08)';
          onFocus?.(e);
        }}
        onBlur={(e: any) => {
          e.currentTarget.style.borderColor = 'var(--border-default)';
          e.currentTarget.style.boxShadow = 'none';
          onBlur?.(e);
        }}
      />
    </div>
  );
}
