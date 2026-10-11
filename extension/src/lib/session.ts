import {
  type AgentState,
  AgoraVoiceAI,
  AgoraVoiceAIEvents,
  type TranscriptHelperItem,
  TranscriptHelperMode,
} from 'agora-agent-client-toolkit'
import AgoraRTC, { type IAgoraRTCClient, type IMicrophoneAudioTrack } from 'agora-rtc-sdk-ng'
import AgoraRTM, { type RTMClient } from 'agora-rtm'

import { getConfig, type SessionConfig, startAgent, stopAgent } from './api'

export type SessionStatus = 'idle' | 'starting' | 'live' | 'ending' | 'error'

export interface TranscriptLine {
  id: string
  speaker: 'Maya' | 'You'
  text: string
}

export interface SessionSnapshot {
  status: SessionStatus
  agentState: AgentState | null
  transcript: TranscriptLine[]
  error: string | null
  micBlocked: boolean
  autoplayBlocked: boolean
  muted: boolean
}

type Listener = (snapshot: SessionSnapshot) => void

const INITIAL: SessionSnapshot = {
  status: 'idle',
  agentState: null,
  transcript: [],
  error: null,
  micBlocked: false,
  autoplayBlocked: false,
  muted: false,
}

// Same lifecycle as web/: get token → start agent + RTM login → join RTC →
// publish mic → subscribe transcripts.
class MayaSession {
  private snapshot: SessionSnapshot = INITIAL
  private listeners = new Set<Listener>()
  private config: SessionConfig | null = null
  private agentId: string | null = null
  private rtc: IAgoraRTCClient | null = null
  private rtm: RTMClient | null = null
  private mic: IMicrophoneAudioTrack | null = null

  constructor() {
    AgoraRTC.onAutoplayFailed = () => this.update({ autoplayBlocked: true })
  }

  subscribe(listener: Listener) {
    this.listeners.add(listener)
    listener(this.snapshot)
    return () => this.listeners.delete(listener)
  }

  private update(patch: Partial<SessionSnapshot>) {
    this.snapshot = { ...this.snapshot, ...patch }
    for (const listener of this.listeners) listener(this.snapshot)
  }

  async start(userKey: string) {
    if (this.snapshot.status === 'starting' || this.snapshot.status === 'live') return
    this.update({ ...INITIAL, status: 'starting' })

    // Ask for the mic before starting an agent, so a denied mic costs nothing.
    try {
      this.mic = await AgoraRTC.createMicrophoneAudioTrack()
    } catch (error) {
      console.error('Microphone unavailable:', error)
      this.update({ status: 'error', micBlocked: true, error: 'Maya needs your microphone.' })
      return
    }

    try {
      const config = await getConfig()
      this.config = config

      const [agentId, rtm] = await Promise.all([
        startAgent(config, userKey.trim() || undefined),
        (async () => {
          const client = new AgoraRTM.RTM(config.app_id, config.uid)
          await client.login({ token: config.token })
          await client.subscribe(config.channel_name)
          return client
        })(),
      ])
      this.agentId = agentId
      this.rtm = rtm

      const rtc = AgoraRTC.createClient({ mode: 'rtc', codec: 'vp8' })
      this.rtc = rtc
      rtc.on('user-published', async (user, mediaType) => {
        await rtc.subscribe(user, mediaType)
        if (mediaType === 'audio') user.audioTrack?.play()
      })
      rtc.on('token-privilege-will-expire', () => void this.renewTokens())

      await rtc.join(config.app_id, config.channel_name, config.token, Number(config.uid))
      await rtc.publish([this.mic])

      const ai = await AgoraVoiceAI.init({
        rtcEngine: rtc,
        rtmConfig: { rtmEngine: rtm },
        renderMode: TranscriptHelperMode.TEXT,
      })
      ai.on(AgoraVoiceAIEvents.TRANSCRIPT_UPDATED, (items) => this.update({ transcript: this.toLines(items) }))
      ai.on(AgoraVoiceAIEvents.AGENT_STATE_CHANGED, (_, event) => this.update({ agentState: event.state }))
      ai.on(AgoraVoiceAIEvents.AGENT_ERROR, (_, error) => console.error('Agent error:', error))
      ai.subscribeMessage(config.channel_name)

      this.update({ status: 'live' })
    } catch (error) {
      console.error('Failed to start session:', error)
      const message = error instanceof Error ? error.message : 'Something went wrong.'
      await this.cleanup()
      this.update({ status: 'error', error: message })
    }
  }

  private toLines(items: TranscriptHelperItem<unknown>[]): TranscriptLine[] {
    const agentUid = this.config?.agent_uid
    return items
      .filter((item) => item.text?.trim())
      .map((item) => ({
        id: `${item.uid}-${item.turn_id}`,
        speaker: String(item.uid) === agentUid ? 'Maya' : 'You',
        text: item.text.trim(),
      }))
  }

  private async renewTokens() {
    if (!this.config) return
    try {
      const fresh = await getConfig({ channel: this.config.channel_name, uid: this.config.uid })
      await this.rtc?.renewToken(fresh.token)
      await this.rtm?.renewToken(fresh.token)
    } catch (error) {
      console.error('Failed to renew RTC token:', error)
    }
  }

  // Must be called from inside a click: browsers only allow audio started by a gesture.
  resumeAudio() {
    for (const user of this.rtc?.remoteUsers ?? []) {
      if (user.audioTrack?.isPlaying) user.audioTrack.stop()
      user.audioTrack?.play()
    }
    this.update({ autoplayBlocked: false })
  }

  async toggleMute() {
    await this.setMuted(!this.snapshot.muted)
  }

  async setMuted(muted: boolean) {
    if (!this.mic || this.snapshot.muted === muted) return
    await this.mic.setEnabled(!muted)
    this.update({ muted })
  }

  async end() {
    if (this.snapshot.status !== 'live' && this.snapshot.status !== 'starting') return
    this.update({ status: 'ending' })
    await this.cleanup()
    this.update({ ...INITIAL, transcript: this.snapshot.transcript })
  }

  // Popup is closing: fire-and-forget the stop so memory is still saved.
  endOnUnload() {
    if (this.agentId) void stopAgent(this.agentId, true)
    this.agentId = null
  }

  private async cleanup() {
    const agentId = this.agentId
    this.agentId = null
    if (agentId) await stopAgent(agentId).catch((error) => console.error('Failed to stop agent:', error))
    try {
      const ai = AgoraVoiceAI.getInstance()
      ai?.unsubscribe()
      ai?.destroy()
    } catch {}
    this.mic?.close()
    this.mic = null
    await this.rtc?.leave().catch(() => {})
    this.rtc = null
    await this.rtm?.logout().catch(() => {})
    this.rtm = null
    this.config = null
  }
}

export const session = new MayaSession()
