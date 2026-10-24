import type { ProviderId } from '@/lib/shared/types'

/** Brand marks from theSVG.org; decorative because the provider name is always shown next to them. */
export function ProviderMark({ provider, size = 16 }: { provider: ProviderId; size?: number }) {
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
