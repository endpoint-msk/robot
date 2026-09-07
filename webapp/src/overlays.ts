// Реестр открытых оверлеев: модалки, шторка пикера времени, лайтбокс, открытая
// строка свайпа. Нужен ровно одному потребителю — системной кнопке «Назад»
// Telegram (и Escape на десктопе): без него она уводила экран из-под открытой
// модалки, а модалка оставалась висеть поверх уже другого экрана.
//
// Стек, а не флаг: пикер времени зовут в том числе из модалки переноса, и
// закрыться должен верхний, а не оба разом.

type Closer = () => void

let stack: { id: number; close: Closer }[] = []
let seq = 0

/** Регистрирует оверлей и возвращает функцию снятия — зовите её в cleanup эффекта. */
export function pushOverlay(close: Closer): () => void {
  const id = ++seq
  stack = [...stack, { id, close }]
  return () => {
    stack = stack.filter((o) => o.id !== id)
  }
}

/** Закрывает верхний оверлей. `false` — закрывать было нечего, решает вызывающий. */
export function closeTopOverlay(): boolean {
  const top = stack[stack.length - 1]
  if (!top) return false
  // Снимаем сразу: закрытие анимированное, и до фактического размонтирования
  // второй тап по «Назад» иначе позвал бы того же самого.
  stack = stack.slice(0, -1)
  top.close()
  return true
}

export const hasOverlay = (): boolean => stack.length > 0
