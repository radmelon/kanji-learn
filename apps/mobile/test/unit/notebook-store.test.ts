import { useNotebookStore } from '../../src/stores/notebook.store'
import { api } from '../../src/lib/api'

jest.mock('../../src/lib/api', () => ({ api: { get: jest.fn(), post: jest.fn(), patch: jest.fn(), delete: jest.fn() } }))

describe('useNotebookStore', () => {
  beforeEach(() => {
    useNotebookStore.setState({ hasLoaded: false, error: null, view: null })
    jest.clearAllMocks()
  })

  it('sets hasLoaded and view on success', async () => {
    ;(api.get as jest.Mock).mockResolvedValue({ sections: [], isEmpty: true })
    await useNotebookStore.getState().load()
    expect(useNotebookStore.getState().hasLoaded).toBe(true)
    expect(useNotebookStore.getState().view).toEqual({ sections: [], isEmpty: true })
  })

  // The store must never leave hasLoaded false on failure — that renders a
  // permanent spinner, which is the shape of the B-227 blank Journal.
  it('sets hasLoaded AND an error on failure, never a permanent spinner', async () => {
    ;(api.get as jest.Mock).mockRejectedValue(new Error('offline'))
    await useNotebookStore.getState().load()
    expect(useNotebookStore.getState().hasLoaded).toBe(true)
    expect(useNotebookStore.getState().error).toBe('offline')
    expect(useNotebookStore.getState().view).toBeNull()
  })

  it('reloads after an edit so the archive reflects the supersede', async () => {
    ;(api.patch as jest.Mock).mockResolvedValue({ id: 'new' })
    ;(api.get as jest.Mock).mockResolvedValue({ sections: [], isEmpty: false })
    await useNotebookStore.getState().editEntry('old', 'revised')
    expect(api.get).toHaveBeenCalledWith('/v1/buddy/notebook')
  })

  it('refuses an edit while offline instead of pretending it saved', async () => {
    ;(api.patch as jest.Mock).mockRejectedValue(new Error('Network request failed'))
    await useNotebookStore.getState().editEntry('id', 'revised')
    expect(useNotebookStore.getState().error).toMatch(/offline|network/i)
  })
})
