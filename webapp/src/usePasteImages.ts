import { useEffect, useRef } from 'react'

/**
 * Вставка картинок из буфера (Ctrl/Cmd+V) на десктопе. Слушаем на window, чтобы
 * работало вне зависимости от фокуса. `preventDefault` только когда в буфере
 * реально есть картинки — иначе перехватили бы обычную вставку текста в поля.
 * onFiles держим в ref: слушатель ставится один раз, но зовёт свежую версию.
 */
export function usePasteImages(onFiles: (files: File[]) => void, enabled = true): void {
  const ref = useRef(onFiles)
  ref.current = onFiles
  const on = useRef(enabled)
  on.current = enabled
  useEffect(() => {
    const handler = (e: ClipboardEvent): void => {
      if (!on.current) return
      const items = e.clipboardData?.items
      if (!items) return
      const files: File[] = []
      for (const item of items) {
        if (item.kind === 'file' && item.type.startsWith('image/')) {
          const file = item.getAsFile()
          if (file) files.push(file)
        }
      }
      if (files.length === 0) return
      e.preventDefault()
      ref.current(files)
    }
    window.addEventListener('paste', handler)
    return () => window.removeEventListener('paste', handler)
  }, [])
}
