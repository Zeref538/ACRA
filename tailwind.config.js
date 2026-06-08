/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  darkMode: 'class',
  theme: {
    screens: {
      xs:  '360px',
      sm:  '640px',
      md:  '768px',
      lg:  '1024px',
      xl:  '1280px',
      '2xl': '1536px',
    },
    extend: {
      fontFamily: {
        heading: ['Figtree', 'sans-serif'],
        body:    ['Inter', 'system-ui', 'sans-serif'],
        mono:    ['Fira Code', 'monospace'],
      },
      // All colors reference CSS custom properties so both themes work
      // at runtime without rebuild. Stored as "R G B" tuples so Tailwind's
      // opacity modifier syntax (e.g. bg-primary/10) still applies correctly.
      colors: {
        bg: {
          base:     'rgb(var(--bg-base)    / <alpha-value>)',
          surface:  'rgb(var(--bg-surface) / <alpha-value>)',
          elevated: 'rgb(var(--bg-elevated)/ <alpha-value>)',
          overlay:  'rgb(var(--bg-overlay) / <alpha-value>)',
        },
        text: {
          primary:   'rgb(var(--text-primary)   / <alpha-value>)',
          secondary: 'rgb(var(--text-secondary) / <alpha-value>)',
          muted:     'rgb(var(--text-muted)     / <alpha-value>)',
          disabled:  'rgb(var(--text-disabled)  / <alpha-value>)',
        },
        primary: {
          DEFAULT: 'rgb(var(--primary)      / <alpha-value>)',
          hover:   'rgb(var(--primary-hover)/ <alpha-value>)',
        },
        accent:  'rgb(var(--accent)  / <alpha-value>)',
        pass:    'rgb(var(--pass)    / <alpha-value>)',
        fail:    'rgb(var(--fail)    / <alpha-value>)',
        warning: 'rgb(var(--warning) / <alpha-value>)',
        info:    'rgb(var(--info)    / <alpha-value>)',
        neutral: 'rgb(var(--neutral) / <alpha-value>)',
        border: {
          subtle:  'rgb(var(--border-subtle)  / <alpha-value>)',
          default: 'rgb(var(--border-default) / <alpha-value>)',
          strong:  'rgb(var(--border-strong)  / <alpha-value>)',
        },
      },
      boxShadow: {
        card: '0 1px 0 0 rgba(255,255,255,0.04) inset, 0 2px 8px rgba(0,0,0,0.45), 0 1px 2px rgba(0,0,0,0.5)',
        'card-hover': '0 4px 16px rgba(0,0,0,0.5), 0 1px 0 rgba(255,255,255,0.06) inset',
      },
      borderRadius: {
        sm: '4px',
        md: '8px',
        lg: '12px',
        xl: '16px',
      },
      keyframes: {
        shimmer: {
          '0%':   { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition:  '200% 0' },
        },
        'fade-in': {
          '0%':   { opacity: '0', transform: 'translateY(8px)' },
          '100%': { opacity: '1', transform: 'translateY(0)'   },
        },
        'slide-up': {
          '0%':   { opacity: '0', transform: 'translateY(16px)' },
          '100%': { opacity: '1', transform: 'translateY(0)'    },
        },
        'slide-in-left': {
          '0%':   { opacity: '0', transform: 'translateX(-10px)' },
          '100%': { opacity: '1', transform: 'translateX(0)'     },
        },
        'scale-in': {
          '0%':   { opacity: '0', transform: 'scale(0.96)' },
          '100%': { opacity: '1', transform: 'scale(1)'    },
        },
        'float': {
          '0%, 100%': { transform: 'translateY(0px)' },
          '50%':      { transform: 'translateY(-5px)' },
        },
        'pulse-ring': {
          '0%':   { transform: 'scale(0.95)', opacity: '0.6' },
          '70%':  { transform: 'scale(1.08)', opacity: '0'   },
          '100%': { transform: 'scale(1.08)', opacity: '0'   },
        },
      },
      animation: {
        shimmer:          'shimmer 2s linear infinite',
        'fade-in':        'fade-in 0.2s ease-out',
        'slide-up':       'slide-up 0.3s ease-out',
        'slide-in-left':  'slide-in-left 0.3s ease-out both',
        'scale-in':       'scale-in 0.2s ease-out both',
        'float':          'float 3s ease-in-out infinite',
        'pulse-ring':     'pulse-ring 1.5s ease-out infinite',
      },
    },
  },
  plugins: [],
}
