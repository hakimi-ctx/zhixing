import { isLegacyProvider } from '@/lib/shared/providers'

/** Brand marks for the original three providers. Other slots get a one-letter badge. */
export function ProviderMark({ provider, label, size = 16 }: { provider: string; label?: string; size?: number }) {
  if (isLegacyProvider(provider)) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={`/brands/${provider}.svg`}
        alt=""
        aria-hidden="true"
        width={size}
        height={size}
        style={{ display: 'block', flexShrink: 0 }}
      />
    )
  }
  const letter = (label || provider).trim().slice(0, 1).toUpperCase() || 'AI'
  return (
    <span
      aria-hidden="true"
      style={{
        width: size,
        height: size,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
        borderRadius: 4,
        background: 'var(--bgColor-accent-muted)',
        color: 'var(--fgColor-accent)',
        fontSize: Math.max(9, size - 6),
        fontWeight: 650,
        lineHeight: 1,
      }}
    >
      {letter}
    </span>
  )
}
