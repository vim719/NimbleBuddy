'use client'

import type { RTMClient } from 'agora-rtm'
import dynamic from 'next/dynamic'
import Link from 'next/link'
import { Suspense, useCallback, useEffect, useRef, useState } from 'react'

import { ErrorBoundary } from '@/components/ErrorBoundary'
import { LoadingSkeleton } from '@/components/LoadingSkeleton'
import { QuickstartPreCallCard } from '@/components/QuickstartPreCallCard'
import { getConfig, startAgent, stopAgent } from '@/services/api'
import type { AgoraRenewalTokens, AgoraTokenData } from '@/types/conversation'

const ConversationComponent = dynamic(() => import('@/components/ConversationComponent'), {
  ssr: false,
})

function waitForRtmConnected(rtmClient: RTMClient, timeoutMs = 600): Promise<void> {
  return new Promise((resolve) => {
    let settled = false
    let timer: ReturnType<typeof setTimeout> | null = null

    const finish = () => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      rtmClient.removeEventListener('status', onStatus)
      resolve()
    }

    const onStatus = (connectionStatus: { newState?: string } | { state?: string } | Record<string, unknown>) => {
      const nextState =
        typeof connectionStatus === 'object' && connectionStatus !== null
          ? 'newState' in connectionStatus
            ? connectionStatus.newState
            : 'state' in connectionStatus
              ? connectionStatus.state
              : undefined
          : undefined
      if (nextState === 'CONNECTED') {
        finish()
      }
    }

    rtmClient.addEventListener('status', onStatus)
    timer = setTimeout(finish, timeoutMs)
  })
}

const AgoraProvider = dynamic(
  async () => {
    const { AgoraRTCProvider, default: AgoraRTC } = await import('agora-rtc-react')

    return {
      default: function AgoraProviders({ children }: { children: React.ReactNode }) {
        const clientRef = useRef<ReturnType<typeof AgoraRTC.createClient> | null>(null)
        if (!clientRef.current) {
          clientRef.current = AgoraRTC.createClient({
            mode: 'rtc',
            codec: 'vp8',
          })
        }

        // Browsers block remote audio that starts after the click gesture has
        // expired. Play() must run inside a user gesture (Safari is strict), so
        // resume on the overlay button or on any click/key press anywhere.
        const [autoplayBlocked, setAutoplayBlocked] = useState(false)
        const resumeAudio = useCallback(() => {
          for (const user of clientRef.current?.remoteUsers ?? []) {
            if (user.audioTrack?.isPlaying) user.audioTrack.stop()
            user.audioTrack?.play()
          }
          setAutoplayBlocked(false)
        }, [])

        useEffect(() => {
          AgoraRTC.onAutoplayFailed = () => setAutoplayBlocked(true)
          return () => {
            AgoraRTC.onAutoplayFailed = undefined
          }
        }, [])

        useEffect(() => {
          if (!autoplayBlocked) return
          window.addEventListener('pointerdown', resumeAudio)
          window.addEventListener('keydown', resumeAudio)
          return () => {
            window.removeEventListener('pointerdown', resumeAudio)
            window.removeEventListener('keydown', resumeAudio)
          }
        }, [autoplayBlocked, resumeAudio])

        return (
          <AgoraRTCProvider client={clientRef.current}>
            {children}
            {autoplayBlocked ? (
              <div className="fixed inset-0 z-[60] flex items-center justify-center bg-white/70 backdrop-blur-sm">
                <button
                  type="button"
                  onClick={resumeAudio}
                  className="flex flex-col items-center gap-3 rounded-3xl border border-border bg-card px-10 py-8 shadow-[0_24px_60px_rgba(20,22,31,0.16)] transition-transform hover:-translate-y-1"
                >
                  <span className="flex h-16 w-16 items-center justify-center rounded-full bg-primary text-3xl text-white shadow-[0_10px_24px_rgba(25,130,196,0.35)]">
                    🔊
                  </span>
                  <span className="text-xl font-bold italic tracking-tight">Tap to hear Anna</span>
                  <span className="text-sm text-muted-foreground">Your browser paused her voice until you tap.</span>
                </button>
              </div>
            ) : null}
          </AgoraRTCProvider>
        )
      },
    }
  },
  { ssr: false },
)

export default function LandingPage() {
  const [showConversation, setShowConversation] = useState(false)
  const [agoraData, setAgoraData] = useState<AgoraTokenData | null>(null)
  const [rtmClient, setRtmClient] = useState<RTMClient | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [agentJoinError, setAgentJoinError] = useState(false)
  const [userKey, setUserKey] = useState('')

  useEffect(() => {
    import('agora-rtc-react').catch(() => {})
    import('agora-rtm').catch(() => {})
  }, [])

  const handleStartConversation = async () => {
    setIsLoading(true)
    setError(null)
    setAgentJoinError(false)

    try {
      const config = await getConfig()
      const appId = config.app_id

      const [agentIdResult, rtm] = await Promise.all([
        startAgent(
          config.channel_name,
          Number(config.agent_uid),
          Number(config.uid),
          userKey.trim() || undefined,
        ).catch((err) => {
          console.error('Failed to start conversation with agent:', err)
          setAgentJoinError(true)
          return undefined
        }),
        (async () => {
          const { default: AgoraRTM } = await import('agora-rtm')
          const nextRtm: RTMClient = new AgoraRTM.RTM(appId, config.uid)
          await nextRtm.login({ token: config.token })
          await waitForRtmConnected(nextRtm)
          await nextRtm.subscribe(config.channel_name)
          return nextRtm
        })(),
      ])

      setRtmClient(rtm)
      setAgoraData({
        token: config.token,
        uid: config.uid,
        channel: config.channel_name,
        appId: config.app_id,
        agentUid: config.agent_uid,
        agentId: agentIdResult,
      })
      setShowConversation(true)
    } catch (nextError) {
      setError('Failed to start conversation. Please try again.')
      console.error('Error starting conversation:', nextError)
    } finally {
      setIsLoading(false)
    }
  }

  const handleTokenWillExpire = useCallback(
    async (uid: string): Promise<AgoraRenewalTokens> => {
      try {
        const channel = agoraData?.channel
        if (!channel) {
          throw new Error('Missing channel for token renewal')
        }

        // Python get_config issues RTM-capable tokens for the configured account,
        // so renew RTM with the same UID used by the RTM client login.
        const [rtcConfig, rtmConfig] = await Promise.all([
          getConfig({ channel, uid }),
          getConfig({ channel, uid: agoraData.uid }),
        ])

        return {
          rtcToken: rtcConfig.token,
          rtmToken: rtmConfig.token,
        }
      } catch (error) {
        console.error('Error renewing token:', error)
        throw error
      }
    },
    [agoraData],
  )

  const handleEndConversation = async () => {
    if (agoraData?.agentId) {
      try {
        await stopAgent(agoraData.agentId)
      } catch (nextError) {
        console.error('Failed to stop agent:', nextError)
      }
    }

    rtmClient?.logout().catch((err) => console.error('RTM logout error:', err))
    setRtmClient(null)
    setAgoraData(null)
    setShowConversation(false)
  }

  return (
    <div className="relative flex h-dvh min-h-screen flex-col overflow-hidden bg-background text-foreground">
      {!showConversation ? (
        <div className="palette-bars" aria-hidden="true">
          <i />
          <i />
          <i />
          <i />
          <i />
          <i />
          <i />
        </div>
      ) : null}
      <div
        className={`flex min-h-0 flex-1 flex-col ${
          showConversation ? 'items-stretch justify-start' : 'items-center justify-center'
        }`}
      >
        <div
          className={`z-10 flex min-h-0 flex-1 flex-col ${
            showConversation
              ? 'h-full w-full max-w-none items-stretch gap-0 px-0 text-left'
              : 'w-full max-w-none items-center justify-center px-4 text-center'
          }`}
        >
          {!showConversation ? (
            <>
            <QuickstartPreCallCard
              isLoading={isLoading}
              error={error}
              userKey={userKey}
              onUserKeyChange={setUserKey}
              onStartConversation={handleStartConversation}
            />
              <Link
                href="/market"
                className="group mt-5 inline-flex items-center gap-2 rounded-full border border-border bg-card px-4 py-2 text-sm font-medium shadow-sm transition-all hover:-translate-y-0.5 hover:border-primary hover:text-primary"
              >
                <span className="flex gap-0.5" aria-hidden="true">
                  <i className="h-3 w-1 rounded-full bg-[var(--c-green)]" />
                  <i className="mt-1 h-2 w-1 rounded-full bg-[var(--c-red)]" />
                  <i className="h-3 w-1 rounded-full bg-[var(--c-blue)]" />
                </span>
                Market Pulse — cited stock &amp; crypto outlooks
                <span className="transition-transform group-hover:translate-x-0.5">→</span>
              </Link>
            </>
          ) : agoraData && rtmClient ? (
            <>
              {agentJoinError ? (
                <div className="max-w-sm rounded-md bg-destructive/10 p-3 text-sm text-destructive">
                  Failed to connect with AI agent. The conversation may not work as expected.
                </div>
              ) : null}
              <Suspense fallback={<LoadingSkeleton />}>
                <ErrorBoundary>
                  <AgoraProvider>
                    <ConversationComponent
                      agoraData={agoraData}
                      rtmClient={rtmClient}
                      onTokenWillExpire={handleTokenWillExpire}
                      onEndConversation={handleEndConversation}
                    />
                  </AgoraProvider>
                </ErrorBoundary>
              </Suspense>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">Failed to load conversation data.</p>
          )}
        </div>
      </div>

      <footer
        className={`fixed inset-x-0 bottom-0 z-40 flex items-center gap-4 px-4 py-4 md:px-6 md:py-6 ${
          showConversation ? 'justify-end' : 'justify-between'
        }`}
      >
        {!showConversation ? (
          <span className="text-xs text-muted-foreground">Built with Claude · Gemini · Antigravity</span>
        ) : null}
        <div className="flex items-center justify-end gap-2 text-muted-foreground">
          <span className="text-xs font-medium uppercase tracking-wide">Powered by</span>
          <span className="text-lg font-semibold tracking-tight text-primary">Nimbleway</span>
        </div>
      </footer>
    </div>
  )
}
