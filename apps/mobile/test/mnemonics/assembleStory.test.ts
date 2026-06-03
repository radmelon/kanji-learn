jest.mock('../../src/mnemonics/cocreationApi', () => ({ assembleCloud: jest.fn() }))
jest.mock('../../src/mnemonics/assembleOnDevice', () => ({
  assembleOnDevice: jest.fn(),
  OnDeviceUnavailableError: class extends Error {},
}))

import { assembleStory } from '../../src/mnemonics/assembleStory'
import { assembleCloud } from '../../src/mnemonics/cocreationApi'
import { assembleOnDevice } from '../../src/mnemonics/assembleOnDevice'

const cloud = assembleCloud as jest.Mock
const onDevice = assembleOnDevice as jest.Mock

const slots = {
  kanji: '持', kanjiMeaning: 'hold', reading: 'もつ',
  components: [{ char: '扌', name: 'tehen', meaning: 'hand', imageKeyword: 'a hand grasping' }],
  locationName: 'Beppu Station', anchor: 'a yellow vending machine',
}

afterEach(() => { cloud.mockReset(); onDevice.mockReset() })

describe('assembleStory (cloud-first testing-phase order)', () => {
  it('uses cloud when it succeeds', async () => {
    cloud.mockResolvedValue({ storyText: 'cloud story', generatedBy: 'cloud' })
    await expect(assembleStory(slots)).resolves.toEqual({ storyText: 'cloud story', generatedBy: 'cloud' })
    expect(onDevice).not.toHaveBeenCalled()
  })
  it('falls to on-device when cloud throws', async () => {
    cloud.mockRejectedValue(new Error('network'))
    onDevice.mockResolvedValue('device story')
    await expect(assembleStory(slots)).resolves.toEqual({ storyText: 'device story', generatedBy: 'on_device' })
  })
  it('falls to the template when cloud AND on-device fail', async () => {
    cloud.mockRejectedValue(new Error('network'))
    onDevice.mockRejectedValue(new Error('unavailable'))
    const res = await assembleStory(slots)
    expect(res.generatedBy).toBe('template')
    expect(res.storyText).toContain('Beppu Station') // the real shared template asserts the slots
  })
})
