import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Dialog } from '@/components/dialog'
import { Button } from '@/components/ui/button'
import { handleServerError } from '@/lib/handle-server-error'

export function PlaygroundCapture(props: {
  mode: 'screen' | 'camera' | null
  onClose: () => void
  onCapture: (file: File) => void
}) {
  const { t } = useTranslation()
  const mode = props.mode
  const onClose = props.onClose
  const video = useRef<HTMLVideoElement>(null)
  const [stream, setStream] = useState<MediaStream | null>(null)
  const [ready, setReady] = useState(false)
  useEffect(() => {
    if (!mode) return
    let cancelled = false
    let active: MediaStream | undefined
    setReady(false)
    const open = async () => {
      if (!window.isSecureContext || !navigator.mediaDevices) {
        throw new Error(
          'Capture requires HTTPS or localhost and a supported browser'
        )
      }
      const media =
        mode === 'screen'
          ? await navigator.mediaDevices.getDisplayMedia({
              video: true,
              audio: false,
            })
          : await navigator.mediaDevices.getUserMedia({
              video: { facingMode: 'environment' },
              audio: false,
            })
      active = media
      if (cancelled) {
        media.getTracks().forEach((track) => track.stop())
        return
      }
      setStream(media)
      if (video.current) {
        video.current.srcObject = media
        await video.current.play()
      }
    }
    void open().catch((error) => {
      if (!cancelled) {
        handleServerError(error)
        onClose()
      }
    })
    return () => {
      cancelled = true
      active?.getTracks().forEach((track) => track.stop())
      setStream(null)
    }
  }, [mode, onClose])
  const captureActive = useRef(false)
  useEffect(() => {
    captureActive.current = !!mode
    return () => {
      captureActive.current = false
    }
  }, [mode])
  useEffect(() => {
    if (!stream || !video.current) return
    video.current.srcObject = stream
    void video.current.play().catch(handleServerError)
  }, [stream])
  const capture = () => {
    const element = video.current
    if (!element || !element.videoWidth) return
    const canvas = document.createElement('canvas')
    canvas.width = Math.min(element.videoWidth, 2048)
    canvas.height = Math.round(
      (element.videoHeight * canvas.width) / element.videoWidth
    )
    canvas
      .getContext('2d')
      ?.drawImage(element, 0, 0, canvas.width, canvas.height)
    canvas.toBlob((blob) => {
      if (!blob || !captureActive.current) return
      props.onCapture(
        new File([blob], `capture-${Date.now()}.png`, { type: 'image/png' })
      )
      stream?.getTracks().forEach((track) => track.stop())
      onClose()
    }, 'image/png')
  }
  return (
    <Dialog
      open={!!props.mode}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
      title={t(props.mode === 'screen' ? 'Take screenshot' : 'Take photo')}
      footer={
        <Button disabled={!ready} onClick={capture}>
          {t('Capture and attach')}
        </Button>
      }
    >
      <video
        ref={video}
        muted
        playsInline
        onLoadedData={() => setReady(true)}
        aria-label={t('Capture preview')}
        className='bg-muted aspect-video w-full rounded-lg'
      />
    </Dialog>
  )
}
