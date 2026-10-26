import { useEffect, useRef, useState } from 'react'

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

/**
 * Картинка, брошенная файлом из папки (Telegram Desktop), встаёт так же, как вставленная.
 * Ловим на всём окне: брошенный мимо ленты файл вебвью открыл бы вместо миниаппа. Пока
 * файл тащат над окном, хук отдаёт true, и лента подсвечивается как цель. Перестановку
 * афиш это не задевает: она идёт указателем, а не drag-and-drop, и файлов в ней нет.
 */
export function useDropImages(onFiles: (files: File[]) => void, enabled = true): boolean {
  const [over, setOver] = useState(false)
  const ref = useRef(onFiles)
  ref.current = onFiles
  const on = useRef(enabled)
  on.current = enabled
  useEffect(() => {
    // dragenter и dragleave приходят на каждом дочернем узле: считаем глубину, иначе
    // подсветка мигала бы на каждой строке под курсором.
    let depth = 0
    const files = (e: DragEvent): boolean => on.current && Array.from(e.dataTransfer?.types ?? []).includes('Files')
    const enter = (e: DragEvent): void => {
      if (!files(e)) return
      e.preventDefault()
      depth += 1
      setOver(true)
    }
    const move = (e: DragEvent): void => {
      if (!files(e)) return
      e.preventDefault()
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
    }
    const leave = (e: DragEvent): void => {
      if (!files(e)) return
      depth = Math.max(0, depth - 1)
      if (depth === 0) setOver(false)
    }
    const drop = (e: DragEvent): void => {
      if (!files(e)) return
      e.preventDefault()
      depth = 0
      setOver(false)
      const picked = Array.from(e.dataTransfer?.files ?? []).filter((f) => f.type.startsWith('image/'))
      if (picked.length > 0) ref.current(picked)
    }
    window.addEventListener('dragenter', enter)
    window.addEventListener('dragover', move)
    window.addEventListener('dragleave', leave)
    window.addEventListener('drop', drop)
    return () => {
      window.removeEventListener('dragenter', enter)
      window.removeEventListener('dragover', move)
      window.removeEventListener('dragleave', leave)
      window.removeEventListener('drop', drop)
    }
  }, [])
  return over
}
