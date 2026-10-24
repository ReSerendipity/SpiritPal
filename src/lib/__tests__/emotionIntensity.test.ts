import { describe, expect, it } from 'vitest'
import { deriveEmotionalIntensity } from '@/lib/memory/emotionIntensity'

const neutral = { emotion: 'neutral', intensity: 0.9, confidence: 0.3 }
const happy = { emotion: 'happy', intensity: 0.6, confidence: 0.8 }
const sad = { emotion: 'sad', intensity: 0.8, confidence: 0.6 }

describe('deriveEmotionalIntensity', () => {
  it('keeps neutral conversation at zero even when the analyzer reports a high neutral score', () => {
    expect(deriveEmotionalIntensity(0, [], neutral, neutral)).toBe(0)
  })

  it('treats an explicit emotion tag as a real signal', () => {
    expect(deriveEmotionalIntensity(0, ['happy'], neutral, neutral)).toBeGreaterThanOrEqual(0.5)
  })

  it('raises intensity when several or intense tags appear, still clamped to 1', () => {
    expect(deriveEmotionalIntensity(0, ['happy', 'excited'], neutral)).toBeGreaterThan(
      deriveEmotionalIntensity(0, ['happy'], neutral),
    )
    expect(deriveEmotionalIntensity(0, ['excited', 'cry', 'angry', 'laugh'], neutral)).toBeLessThanOrEqual(1)
  })

  it('uses analyzer emotion weight and never lowers an existing value', () => {
    const analyzed = deriveEmotionalIntensity(0, [], neutral, sad)
    expect(analyzed).toBeGreaterThan(0.3)
    expect(deriveEmotionalIntensity(0.9, ['happy'], neutral, sad)).toBe(0.9)
  })

  it('ignores non-emotional scene tags such as idle and wave', () => {
    expect(deriveEmotionalIntensity(0, ['idle', 'wave', 'think'], neutral)).toBe(0)
  })
})
