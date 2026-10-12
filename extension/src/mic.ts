// Chrome can't show the microphone prompt inside a toolbar popup, so the popup
// opens this page once. Permission granted here applies to the whole extension.
import './popup/styles.css'

const status = document.getElementById('status')
const button = document.getElementById('allow')

async function requestMic() {
  if (!status) return
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    for (const track of stream.getTracks()) track.stop()
    status.textContent = 'Microphone allowed. Close this tab and click the Anna icon again.'
    status.className = 'ok'
  } catch {
    status.textContent =
      'Microphone is blocked. Click the icon at the left of the address bar, allow Microphone, then try again.'
    status.className = 'error'
  }
}

button?.addEventListener('click', () => void requestMic())
void requestMic()
