// PRE-LAUNCH: reorder for keyless users (on-device first, cloud only for BYOK). See spec §7.3.
import { assembleTemplate, type AssemblerSlots, type AssemblyTier } from '@kanji-learn/shared'
import { assembleCloud } from './cocreationApi'
import { assembleOnDevice } from './assembleOnDevice'

export interface AssembledStory { storyText: string; generatedBy: AssemblyTier }

/**
 * Cloud → on-device → template. Cloud-first during the testing phase.
 * Each tier falls through on any error; the template always succeeds (pure, offline).
 */
export async function assembleStory(slots: AssemblerSlots): Promise<AssembledStory> {
  try {
    const r = await assembleCloud(slots)
    if (r?.storyText?.trim()) return { storyText: r.storyText.trim(), generatedBy: 'cloud' }
  } catch { /* fall through */ }
  try {
    const text = await assembleOnDevice(slots)
    if (text?.trim()) return { storyText: text.trim(), generatedBy: 'on_device' }
  } catch { /* fall through */ }
  return { storyText: assembleTemplate(slots), generatedBy: 'template' }
}
