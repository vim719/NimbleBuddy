import { useEffect, useRef, useState } from 'react'

import { session, type SessionSnapshot } from '../lib/session'

const NAME_KEY = 'maya:userKey'

function readName(): string {
  try {
    return localStorage.getItem(NAME_KEY) ?? ''
  } catch {
    return ''
  }
}

function stateLabel(snapshot: SessionSnapshot): string {
  if (snapshot.status === 'starting') return 'Connecting…'
  if (snapshot.status === 'ending') return 'Saving our chat…'
  switch (snapshot.agentState) {
    case 'speaking':
      return 'Maya is talking'
    case 'thinking':
      return 'Maya is thinking'
    case 'listening':
      return 'Listening'
    default:
      return 'Say hi'
  }
}

export function App() {
  const [snapshot, setSnapshot] = useState<SessionSnapshot | null>(null)
  const [name, setName] = useState(readName)
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const unsubscribe = session.subscribe(setSnapshot)
    // Closing the popup ends the call; stop the agent so the chat is remembered.
    const onHide = () => session.endOnUnload()
    window.addEventListener('pagehide', onHide)
    return () => {
      unsubscribe()
      window.removeEventListener('pagehide', onHide)
    }
  }, [])

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight })
  }, [snapshot?.transcript])

  // Push-to-talk keys: "A" starts listening, "X" stops all input until "A".
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.repeat || event.metaKey || event.ctrlKey || event.altKey) return
      if ((event.target as HTMLElement | null)?.closest('input, textarea')) return
      const key = event.key.toLowerCase()
      if (key === 'a') void session.setMuted(false)
      if (key === 'x') void session.setMuted(true)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  if (!snapshot) return null
  const inCall = snapshot.status === 'live' || snapshot.status === 'starting' || snapshot.status === 'ending'

  const start = () => {
    try {
      localStorage.setItem(NAME_KEY, name.trim())
    } catch {}
    void session.start(name)
  }

  const openMicPage = () => {
    void chrome.tabs.create({ url: chrome.runtime.getURL('mic.html') })
  }

  return (
    <main className="popup">
      <header className="header">
        <img src="icon-192.png" alt="" className="avatar" />
        <div>
          <h1>Maya</h1>
          <p className="subtitle">{inCall ? stateLabel(snapshot) : 'Your AI companion'}</p>
        </div>
      </header>

      {!inCall ? (
        <section className="setup">
          <label htmlFor="name">Your name</label>
          <input
            id="name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="So Maya remembers you"
            onKeyDown={(event) => event.key === 'Enter' && start()}
          />
          <button type="button" className="primary" onClick={start}>
            Start talking
          </button>
          {snapshot.error ? <p className="error">{snapshot.error}</p> : null}
          {snapshot.micBlocked ? (
            <button type="button" className="secondary" onClick={openMicPage}>
              Allow microphone
            </button>
          ) : null}
        </section>
      ) : (
        <section className="call">
          <div className={`orb orb-${snapshot.agentState ?? 'idle'}`} aria-hidden="true" />
          <div className="transcript" ref={scrollRef}>
            {snapshot.transcript.length === 0 ? (
              <p className="empty">Start speaking — Maya can hear you.</p>
            ) : (
              snapshot.transcript.slice(-20).map((line) => (
                <p key={line.id} className={line.speaker === 'Maya' ? 'line maya' : 'line you'}>
                  <span>{line.speaker}</span>
                  {line.text}
                </p>
              ))
            )}
          </div>
          {snapshot.autoplayBlocked ? (
            <button type="button" className="primary" onClick={() => session.resumeAudio()}>
              Tap to hear Maya
            </button>
          ) : null}
          <p className="hint">
            <b className={snapshot.muted ? 'off' : 'on'}>{snapshot.muted ? 'Mic off' : 'Listening'}</b>
            <kbd>A</kbd> talk · <kbd>X</kbd> stop listening
          </p>
          <div className="controls">
            <button type="button" className="secondary" onClick={() => void session.toggleMute()}>
              {snapshot.muted ? 'Unmute' : 'Mute'}
            </button>
            <button
              type="button"
              className="danger"
              disabled={snapshot.status === 'ending'}
              onClick={() => void session.end()}
            >
              End call
            </button>
          </div>
        </section>
      )}

      <footer className="footer">
        Keep this popup open while you talk. <span>Powered by Nimbleway</span>
      </footer>
    </main>
  )
}
