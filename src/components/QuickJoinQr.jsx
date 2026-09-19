import { useEffect, useState } from 'react'

export default function QuickJoinQr({ url, className = '', alt = 'QR 간편 입장 코드' }) {
  const [src, setSrc] = useState('')

  useEffect(() => {
    if (!url) return
    let alive = true
    const css = getComputedStyle(document.documentElement)
    import('qrcode')
      .then(({ default: QRCode }) => QRCode.toDataURL(url, {
        width: 240,
        margin: 2,
        errorCorrectionLevel: 'M',
        color: {
          dark: css.getPropertyValue('--qr-ink').trim(),
          light: css.getPropertyValue('--qr-bg').trim(),
        },
      }))
      .then((value) => alive && setSrc(value))
      .catch(() => alive && setSrc(''))
    return () => {
      alive = false
    }
  }, [url])

  return src ? <img className={className} src={src} alt={alt} /> : null
}
