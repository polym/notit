// Word pronunciation through the Web Speech API (spec "selection translation"). Runs in the content
// script and only from the pronounce click: Chrome refuses speak() without user activation. The
// voice list loads asynchronously; an empty list is "not loaded yet", not "no voice".

let cached: SpeechSynthesisVoice | null | undefined

function englishVoice(): SpeechSynthesisVoice | null | undefined {
  const voices = globalThis.speechSynthesis?.getVoices() ?? []
  if (voices.length === 0) return undefined
  return voices.find((v) => v.lang === 'en-US') ?? voices.find((v) => v.lang.startsWith('en')) ?? null
}

// Warm the list so the first click finds a voice.
globalThis.speechSynthesis?.addEventListener?.('voiceschanged', () => {
  cached = englishVoice()
})

/** True only when the voice list has loaded and holds no English voice (or there is no API). */
export function noEnglishVoice(): boolean {
  if (!globalThis.speechSynthesis) return true
  if (cached === undefined) cached = englishVoice()
  return cached === null
}

export function speak(word: string): void {
  const synth = globalThis.speechSynthesis
  if (!synth) return
  if (cached === undefined) cached = englishVoice()
  const utterance = new SpeechSynthesisUtterance(word)
  utterance.lang = cached?.lang ?? 'en-US'
  if (cached) utterance.voice = cached
  synth.cancel()
  synth.speak(utterance)
}
