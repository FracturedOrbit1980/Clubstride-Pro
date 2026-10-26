/**
 * Clubstride CI v1.0.0, the `[data-surface='lite']` block of clubstride-tokens.css.
 *
 * Pro is the Lite product on a coach's phone, so it wears the same identity rather than a
 * separate palette: navy shell, cyan primary, go-green for positive actions, volt for
 * highlights and the L1 symbol. A token change lands here once, not in every screen.
 */
export const ci = {
  color: {
    background: '#0A1630',
    surface: '#13224A',
    raised: '#1B2E5E',
    border: '#26354D',
    borderInput: '#5B6B84',
    text: '#FFFFFF',
    muted: '#B8C6E6',
    primary: '#22D3EE',
    onPrimary: '#06142B',
    go: '#3BE38A',
    onGo: '#06142B',
    accent: '#C8F230',
    onAccent: '#06142B',
    danger: '#FF8A80',
    onDanger: '#06142B',
    warning: '#FBBF24',
    onWarning: '#06142B',
    success: '#3BE38A',
    disabledBg: '#26354D',
    disabledText: '#7A8AA3',
    scrim: 'rgba(6, 13, 24, 0.72)',
  },
  radius: {
    chip: 8,
    control: 12,
    card: 18,
    sheet: 28,
    pill: 999,
  },
} as const;
