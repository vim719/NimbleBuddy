'use client'

import { type CSSProperties, useEffect, useState } from 'react'

const STEP_MS = 70
const LETTER_MS = 1800
const REST_MS = 19000

// Splits text into letters that each take a palette colour on hover. With
// `autoWave`, the letters also run through the palette one after another, then
// rest in their normal colour for 19 seconds before the next round.
// Screen readers get the plain text via aria-label.
export function HoverLetters({ text, offset = 0, autoWave = false }: { text: string; offset?: number; autoWave?: boolean }) {
  const [waving, setWaving] = useState(false)
  const letterCount = Array.from(text.replace(/\s+/g, '')).length

  useEffect(() => {
    if (!autoWave || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    let timer: ReturnType<typeof setTimeout>
    const roundMs = letterCount * STEP_MS + LETTER_MS
    const start = () => {
      setWaving(true)
      timer = setTimeout(() => {
        setWaving(false)
        timer = setTimeout(start, REST_MS)
      }, roundMs)
    }
    timer = setTimeout(start, 1200)
    return () => clearTimeout(timer)
  }, [autoWave, letterCount])

  let index = offset
  return (
    <span className={`hover-letters${waving ? ' wave' : ''}`} aria-label={text}>
      {text.split(/(\s+)/).map((part, wordIndex) => {
        if (/^\s+$/.test(part)) return part
        return (
          <span key={`${wordIndex}-${part}`} className="hl-word" aria-hidden="true">
            {Array.from(part).map((char, charIndex) => {
              const i = index++
              return (
                <span key={charIndex} className={`hl hl-${i % 5}`} style={{ '--i': i - offset } as CSSProperties}>
                  {char}
                </span>
              )
            })}
          </span>
        )
      })}
    </span>
  )
}
