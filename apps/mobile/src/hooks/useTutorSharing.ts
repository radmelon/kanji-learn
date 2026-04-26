import { useState, useCallback, useEffect } from 'react'
import { api, ApiError } from '../lib/api'

interface TutorShareInfo {
  id: string
  teacherEmail: string
  status: 'pending' | 'accepted' | 'declined' | 'revoked' | 'expired'
  createdAt: string
  expiresAt: string
  // Present only for live shares (pending or accepted). Server omits it for
  // revoked/declined/expired so a stale link cannot be re-shared.
  shareUrl?: string
}

interface TutorNote {
  id: string
  noteText: string
  createdAt: string
}

export function useTutorSharing() {
  const [share, setShare] = useState<TutorShareInfo | null>(null)
  const [noteCount, setNoteCount] = useState(0)
  const [notes, setNotes] = useState<TutorNote[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [isSending, setIsSending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const loadStatus = useCallback(async () => {
    setIsLoading(true)
    try {
      const data = await api.get<{ share: TutorShareInfo | null; noteCount: number }>('/v1/tutor-sharing/status')
      setShare(data.share)
      setNoteCount(data.noteCount)
    } catch {
      // silently fail
    } finally {
      setIsLoading(false)
    }
  }, [])

  const loadNotes = useCallback(async () => {
    try {
      const data = await api.get<TutorNote[]>('/v1/tutor-sharing/notes')
      setNotes(data)
    } catch {
      // silently fail
    }
  }, [])

  useEffect(() => { loadStatus() }, [loadStatus])

  useEffect(() => {
    if (share?.status === 'accepted') {
      loadNotes()
    }
  }, [share?.status, loadNotes])

  const sendInvite = useCallback(async (email: string): Promise<boolean> => {
    setIsSending(true)
    setError(null)
    try {
      await api.post('/v1/tutor-sharing/invite', { teacherEmail: email })
      await loadStatus()
      return true
    } catch (err) {
      if (err instanceof ApiError && err.code === 'SHARE_ALREADY_EXISTS') {
        setError('You already have a pending or active share. Revoke it first to invite a new tutor.')
      } else if (err instanceof ApiError && err.code === 'SELF_INVITE_NOT_ALLOWED') {
        setError('You cannot invite yourself.')
      } else {
        setError('Failed to send invite. Please try again.')
      }
      return false
    } finally {
      setIsSending(false)
    }
  }, [loadStatus])

  const revoke = useCallback(async (): Promise<boolean> => {
    if (!share) return false
    setIsSending(true)
    setError(null)
    try {
      await api.delete(`/v1/tutor-sharing/${share.id}`)
      await loadStatus()
      return true
    } catch {
      setError('Failed to revoke access. Please try again.')
      return false
    } finally {
      setIsSending(false)
    }
  }, [share, loadStatus])

  const refresh = useCallback(async () => {
    await loadStatus()
  }, [loadStatus])

  return {
    share,
    noteCount,
    notes,
    isLoading,
    isSending,
    error,
    sendInvite,
    revoke,
    refresh,
  }
}
