import { AppleFoundationModels } from '@react-native-ai/apple'
import { buildAssemblyPrompt, COCREATION_SYSTEM_PROMPT, type AssemblerSlots } from '@kanji-learn/shared'

/** Thrown when on-device generation is unavailable or yields nothing — the
 *  assembly cascade catches this and falls to the next tier (template). */
export class OnDeviceUnavailableError extends Error {
  constructor(cause?: unknown) {
    super(`On-device assembly unavailable: ${String(cause ?? 'no output')}`)
    this.name = 'OnDeviceUnavailableError'
  }
}

/**
 * Assemble a mnemonic story on-device via Apple Foundation Models
 * (@react-native-ai/apple, the direct AppleFoundationModels TurboModule).
 * Throws OnDeviceUnavailableError on unavailability/empty output so the
 * cascade can fall back to cloud/template. Uses the same prompt as the
 * cloud tier (shared `buildAssemblyPrompt` / `COCREATION_SYSTEM_PROMPT`).
 */
export async function assembleOnDevice(slots: AssemblerSlots): Promise<string> {
  if (!AppleFoundationModels.isAvailable()) {
    throw new OnDeviceUnavailableError('Apple Intelligence unavailable')
  }
  let parts: Array<{ type: string; text?: string }>
  try {
    parts = await AppleFoundationModels.generateText(
      [
        { role: 'system', content: COCREATION_SYSTEM_PROMPT },
        { role: 'user', content: buildAssemblyPrompt(slots) },
      ],
      { maxTokens: 400 },
    )
  } catch (e) {
    throw new OnDeviceUnavailableError(e)
  }
  const text = parts.find((p) => p.type === 'text')?.text?.trim()
  if (!text) throw new OnDeviceUnavailableError()
  return text
}
