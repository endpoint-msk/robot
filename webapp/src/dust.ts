// Удалённое рассыпается, как сообщение в Telegram: то, что убрали своим тапом, уходит
// точками в цветах самой строки, а её место сворачивается следом. «Вернуть» собирает её
// обратно из тех же точек.
//
// Снимок строки рисуется в холст без html2canvas, по её раскладке: подложки и градиенты
// своим цветом и радиусом, текст тем же шрифтом по своим строкам (Range.getClientRects),
// картинки и значки поверх. Точка берёт цвет пикселя, на котором стояла, поэтому
// рассыпается именно эта строка, а не серое пятно. Необычное (размытие, маска, градиент
// текста) в холсте выйдет проще: в строках, которые здесь рассыпаются, такого нет.

import { animate, clamp, E, pr, reducedMotion } from './motion'

/** Шаг сетки точек, px: мельче - и длинная строка на экране 3x тормозит. */
const STEP = 2
/** Волна проходит строку слева направо за WAVE; соседние точки срываются вразброс на JITTER. */
const WAVE = 420
const JITTER = 90
/** Сколько точка летит после срыва, самое долгое. */
const LIFE = 1030
const DUST_MS = WAVE + JITTER + LIFE
/** Место сворачивается, когда волна прошла строку почти всю. */
const FOLD_DELAY = 450
const FOLD_MS = 360
/** Сборка идёт с середины полёта: в конце пути точки уже прозрачные, и она начиналась бы с пустоты. */
const BACK_FROM = 700
const BACK_MS = 1000

type Particle = { x: number; y: number; r: number; g: number; b: number; a: number; d: number; life: number; vx: number; vy: number; ph: number }

/**
 * Точки строки в её координатах: по «Вернуть» они собираются туда, где строка встанет снова.
 * `image` - сам снимок: до прихода волны строка рисуется им, а не точками.
 */
export type Dust = { parts: Particle[]; w: number; h: number; image: HTMLCanvasElement; S: number }

// --- снимок -------------------------------------------------------------------------

const clear = (c: string): boolean => !c || c === 'transparent' || /rgba\([^)]*,\s*0\)$/.test(c)

const rounded = (ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void => {
  const k = Math.max(0, Math.min(r, w / 2, h / 2))
  ctx.beginPath()
  ctx.moveTo(x + k, y)
  ctx.arcTo(x + w, y, x + w, y + h, k)
  ctx.arcTo(x + w, y + h, x, y + h, k)
  ctx.arcTo(x, y + h, x, y, k)
  ctx.arcTo(x, y, x + w, y, k)
  ctx.closePath()
}

/** Видимая прозрачность узла: полупрозрачными могли быть и его родители внутри строки. */
const alphaOf = (el: Element, root: Element): number => {
  let a = 1
  for (let n: Element | null = el; n; n = n === root ? null : n.parentElement) a *= Number(getComputedStyle(n).opacity)
  return a
}

const hidden = (cs: CSSStyleDeclaration): boolean => cs.visibility === 'hidden' || cs.display === 'none'

/** Ближайший предок (или сам узел), который срезает содержимое по своему скруглению. */
const clipperOf = (root: HTMLElement): HTMLElement | null => {
  for (let n: HTMLElement | null = root; n && n !== document.body; n = n.parentElement) {
    const cs = getComputedStyle(n)
    if (cs.overflow !== 'visible' && (parseFloat(cs.borderTopLeftRadius) || 0) > 0) return n
  }
  return null
}

/** Копия значка с уже посчитанными цветами: currentColor и var() в картинке не разрешатся. */
const svgImage = (svg: SVGSVGElement): Promise<HTMLImageElement | null> =>
  new Promise((resolve) => {
    const clone = svg.cloneNode(true) as SVGSVGElement
    const src = [svg, ...Array.from(svg.querySelectorAll('*'))]
    const dst = [clone, ...Array.from(clone.querySelectorAll('*'))]
    src.forEach((el, i) => {
      const cs = getComputedStyle(el)
      const d = dst[i]
      if (!d) return
      d.removeAttribute('style')
      d.setAttribute('fill', cs.fill)
      d.setAttribute('stroke', cs.stroke)
    })
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => resolve(null)
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(new XMLSerializer().serializeToString(clone))
  })

/** Строки поля ввода: значение не лежит в дереве текстом, его переносим по ширине сами. */
const fieldLines = (ctx: CanvasRenderingContext2D, value: string, width: number): string[] => {
  const out: string[] = []
  for (const para of value.split('\n')) {
    let line = ''
    for (const word of para.split(/(\s+)/)) {
      const next = line + word
      if (line && ctx.measureText(next).width > width) {
        out.push(line)
        line = word.trimStart()
      } else line = next
    }
    out.push(line)
  }
  return out
}

type Snap = { canvas: HTMLCanvasElement; w: number; h: number; S: number }

async function snapshot(root: HTMLElement, ink: boolean): Promise<Snap | null> {
  const rb = root.getBoundingClientRect()
  const w = rb.width
  const h = rb.height
  if (w < 1 || h < 1) return null
  const S = Math.min(2, window.devicePixelRatio || 1)
  const canvas = document.createElement('canvas')
  canvas.width = Math.ceil(w * S)
  canvas.height = Math.ceil(h * S)
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return null
  ctx.scale(S, S)
  const rel = (b: DOMRect): { x: number; y: number; w: number; h: number } => ({ x: b.left - rb.left, y: b.top - rb.top, w: b.width, h: b.height })

  // Заливки потомков, вылезающие за скругление карточки (слой строки со свайпом), в жизни
  // срезает её overflow. В холсте режем так же, иначе рассыпаются острые углы.
  const clipper = clipperOf(root)
  if (clipper) {
    const b = rel(clipper.getBoundingClientRect())
    ctx.save()
    rounded(ctx, b.x, b.y, b.w, b.h, parseFloat(getComputedStyle(clipper).borderTopLeftRadius) || 0)
    ctx.clip()
  }

  // Своей подложки у строки обычно нет, её несёт карточка: заливаем её цветом в форме
  // карточки, чтобы у крайней строки и углы рассыпались скруглёнными.
  if (!ink && clear(getComputedStyle(root).backgroundColor)) {
    let host: Element | null = root.parentElement
    while (host && clear(getComputedStyle(host).backgroundColor)) host = host.parentElement
    const cs = getComputedStyle(host ?? document.body)
    const b = rel((host ?? document.body).getBoundingClientRect())
    ctx.save()
    rounded(ctx, b.x, b.y, b.w, b.h, parseFloat(cs.borderTopLeftRadius) || 0)
    ctx.clip()
    ctx.fillStyle = clear(cs.backgroundColor) ? getComputedStyle(document.body).backgroundColor : cs.backgroundColor
    ctx.fillRect(0, 0, w, h)
    ctx.restore()
  }

  for (const el of [root, ...Array.from(root.querySelectorAll<HTMLElement>('*'))]) {
    if (el.closest('svg')) continue
    const cs = getComputedStyle(el)
    if (hidden(cs)) continue
    const b = rel(el.getBoundingClientRect())
    if (b.w < 1 || b.h < 1) continue
    const r = parseFloat(cs.borderTopLeftRadius) || 0
    const a = alphaOf(el, root)
    if (a <= 0.02) continue
    ctx.globalAlpha = a
    const img = cs.backgroundImage
    if (!ink && img && img.startsWith('linear-gradient')) {
      const cols = img.match(/rgba?\([^)]*\)/g) ?? []
      if (cols.length) {
        const g = ctx.createLinearGradient(b.x, b.y, b.x + b.w, b.y + b.h)
        g.addColorStop(0, cols[0]!)
        g.addColorStop(1, cols[cols.length - 1]!)
        ctx.fillStyle = g
        rounded(ctx, b.x, b.y, b.w, b.h, r)
        ctx.fill()
      }
    } else if (!ink && !clear(cs.backgroundColor)) {
      ctx.fillStyle = cs.backgroundColor
      rounded(ctx, b.x, b.y, b.w, b.h, r)
      ctx.fill()
    }
    if (el instanceof HTMLImageElement && el.complete && el.naturalWidth > 0) {
      // object-fit: cover, как у аватарок.
      const k = Math.max(b.w / el.naturalWidth, b.h / el.naturalHeight)
      const sw = b.w / k
      const sh = b.h / k
      ctx.save()
      rounded(ctx, b.x, b.y, b.w, b.h, r)
      ctx.clip()
      ctx.drawImage(el, (el.naturalWidth - sw) / 2, (el.naturalHeight - sh) / 2, sw, sh, b.x, b.y, b.w, b.h)
      ctx.restore()
    }
    if ((el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) && el.value) {
      const pl = parseFloat(cs.paddingLeft) || 0
      const pr0 = parseFloat(cs.paddingRight) || 0
      const pt = parseFloat(cs.paddingTop) || 0
      const size = parseFloat(cs.fontSize) || 16
      const lh = parseFloat(cs.lineHeight) || size * 1.25
      ctx.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`
      ctx.fillStyle = cs.color
      ctx.textBaseline = 'middle'
      ctx.save()
      ctx.beginPath()
      ctx.rect(b.x, b.y, b.w, b.h)
      ctx.clip()
      fieldLines(ctx, el.value, b.w - pl - pr0).forEach((line, i) => {
        ctx.fillText(line, b.x + pl, b.y + pt + lh * i + lh / 2 - el.scrollTop)
      })
      ctx.restore()
    }
  }

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  const range = document.createRange()
  while (walker.nextNode()) {
    const n = walker.currentNode as Text
    const el = n.parentElement
    if (!el || el.closest('svg') || !(n.nodeValue ?? '').trim()) continue
    const cs = getComputedStyle(el)
    if (hidden(cs)) continue
    const a = alphaOf(el, root)
    if (a <= 0.02) continue
    ctx.globalAlpha = a
    ctx.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`
    ctx.fillStyle = cs.color
    ctx.textBaseline = 'middle'
    if ('letterSpacing' in ctx) (ctx as { letterSpacing: string }).letterSpacing = cs.letterSpacing === 'normal' ? '0px' : cs.letterSpacing
    const upper = cs.textTransform === 'uppercase'
    const box = rel(el.getBoundingClientRect())
    ctx.save()
    // Обрезанный многоточием текст режем по своему узлу.
    ctx.beginPath()
    ctx.rect(box.x, box.y - 3, box.w, box.h + 6)
    ctx.clip()
    const text = n.nodeValue ?? ''
    // Пробелы по краям узла раскладка схлопывает: рисуем ровно то, что видно.
    const first = text.search(/\S/)
    const last = text.length - (/\s*$/.exec(text)?.[0].length ?? 0)
    range.setStart(n, first)
    range.setEnd(n, last)
    const lines = Array.from(range.getClientRects()).filter((x) => x.width > 0)
    const put = (s: string, r: DOMRect): void => {
      const b = rel(r)
      ctx.fillText((upper ? s.toUpperCase() : s).replace(/\s+/g, ' '), b.x, b.y + b.h / 2 + 0.5)
    }
    if (lines.length === 1) put(text.slice(first, last), lines[0]!)
    else {
      // Перенесённый текст - по словам, каждое на своём месте.
      const re = /\S+/g
      let m: RegExpExecArray | null
      while ((m = re.exec(text))) {
        range.setStart(n, m.index)
        range.setEnd(n, m.index + m[0].length)
        const r = range.getClientRects()[0]
        if (r && r.width > 0) put(m[0], r)
      }
    }
    ctx.restore()
  }
  ctx.globalAlpha = 1

  // Места значков снимаются сейчас: к загрузке картинок строка может уже свернуться.
  const icons = Array.from(root.querySelectorAll<SVGSVGElement>('svg'))
    .filter((s) => !s.parentElement?.closest('svg') && !hidden(getComputedStyle(s)))
    .map((s) => ({ box: rel(s.getBoundingClientRect()), a: alphaOf(s, root), img: svgImage(s) }))
  const imgs = await Promise.all(icons.map((i) => i.img))
  imgs.forEach((img, i) => {
    const icon = icons[i]!
    if (!img || icon.box.w <= 0) return
    ctx.globalAlpha = icon.a
    ctx.drawImage(img, icon.box.x, icon.box.y, icon.box.w, icon.box.h)
  })
  ctx.globalAlpha = 1
  if (clipper) ctx.restore()
  return { canvas, w, h, S }
}

/** Точки снимка. Зерно постоянное: строка всякий раз рассыпается одинаково. */
function particles(snap: Snap): Particle[] {
  const { canvas, w, h, S } = snap
  const data = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data
  let seed = 7
  const rnd = (): number => {
    seed = (seed * 16807) % 2147483647
    return (seed - 1) / 2147483646
  }
  const list: Particle[] = []
  for (let y = 0; y < h - 0.5; y += STEP) {
    for (let x = 0; x < w - 0.5; x += STEP) {
      const i = (Math.round(y * S) * canvas.width + Math.round(x * S)) * 4
      const a = data[i + 3] ?? 0
      if (a < 10) continue
      list.push({
        x,
        y,
        r: data[i] ?? 0,
        g: data[i + 1] ?? 0,
        b: data[i + 2] ?? 0,
        a: a / 255,
        d: (x / w) * WAVE + rnd() * JITTER,
        life: 640 + rnd() * (LIFE - 640),
        vx: 30 + rnd() * 110,
        vy: -(40 + rnd() * 120),
        ph: rnd() * 6.28,
      })
    }
  }
  return list
}

/**
 * Снимок строки в точки, пока она стоит на месте. null - рисовать нечего или движение
 * выключено. `ink` - только текст, значки и картинки, без подложек: рассыпается
 * содержимое, а место под ним остаётся.
 */
export async function capture(el: HTMLElement, opts: { ink?: boolean } = {}): Promise<Dust | null> {
  if (reducedMotion()) return null
  try {
    const snap = await snapshot(el, opts.ink === true)
    return snap ? { parts: particles(snap), w: snap.w, h: snap.h, image: snap.canvas, S: snap.S } : null
  } catch {
    return null
  }
}

// --- полёт -----------------------------------------------------------------------------

/**
 * Проигрывает точки над местом строки (левый верхний угол в координатах окна) от времени
 * `from` к `to` за `ms`. Холст лежит поверх всего и пальцы пропускает.
 */
function fly(dust: Dust, left: number, top: number, from: number, to: number, ms: number, ease: (p: number) => number): Promise<void> {
  // Вверх и вправо точки улетают далеко: холст накрывает строку с запасом.
  const area = { x: left - 6, y: top - 170, w: dust.w + 176, h: dust.h + 190 }
  const D = Math.min(2, window.devicePixelRatio || 1)
  const cw = Math.ceil(area.w * D)
  const ch = Math.ceil(area.h * D)
  const cv = document.createElement('canvas')
  cv.className = 'dust-layer'
  cv.width = cw
  cv.height = ch
  Object.assign(cv.style, { left: `${area.x}px`, top: `${area.y}px`, width: `${area.w}px`, height: `${area.h}px` })
  document.body.appendChild(cv)
  const ctx = cv.getContext('2d')
  if (!ctx) {
    cv.remove()
    return Promise.resolve()
  }
  const img = ctx.createImageData(cw, ch)
  const buf = img.data
  // Правее волны не сорвалась ещё ни одна точка: там строка рисуется снимком, иначе
  // крупное зерно точек читалось бы как размытая строка ещё до того, как она рассыпалась.
  const draw = (t: number): void => {
    buf.fill(0)
    const front = clamp((t / WAVE) * dust.w, 0, dust.w)
    for (const p of dust.parts) {
      if (p.x >= front) continue
      const tau = t - p.d
      let x = left + p.x
      let y = top + p.y
      let a = p.a
      let s = STEP
      if (tau > 0) {
        const q = Math.min(1, tau / p.life)
        const ts = tau / 1000
        x += p.vx * ts + Math.sin(p.ph + ts * 9) * 3 * q
        y += p.vy * ts - 60 * ts * ts
        a *= Math.pow(1 - q, 1.3)
        s = STEP * (1 - 0.35 * q)
        if (a <= 0.01) continue
      }
      const px = Math.round((x - area.x) * D)
      const py = Math.round((y - area.y) * D)
      const ps = Math.max(1, Math.round(s * D))
      const al = Math.round(a * 255)
      for (let yy = 0; yy < ps; yy++) {
        const row = py + yy
        if (row < 0 || row >= ch) continue
        for (let xx = 0; xx < ps; xx++) {
          const col = px + xx
          if (col < 0 || col >= cw) continue
          const i = (row * cw + col) * 4
          buf[i] = p.r
          buf[i + 1] = p.g
          buf[i + 2] = p.b
          buf[i + 3] = al
        }
      }
    }
    ctx.putImageData(img, 0, 0)
    if (front < dust.w) {
      const S = dust.S
      ctx.drawImage(
        dust.image,
        front * S,
        0,
        (dust.w - front) * S,
        dust.h * S,
        (left - area.x + front) * D,
        (top - area.y) * D,
        (dust.w - front) * D,
        dust.h * D,
      )
    }
  }
  return new Promise((resolve) => {
    animate(
      ms,
      (t) => draw(from + (to - from) * ease(t / ms)),
      () => {
        cv.remove()
        resolve()
      },
    )
  })
}

// --- место строки ------------------------------------------------------------------------

type Box = { el: HTMLElement; h: number; mt: number; mb: number; pt: number; pb: number }

const boxOf = (el: HTMLElement): Box => {
  const cs = getComputedStyle(el)
  return {
    el,
    h: el.offsetHeight,
    mt: parseFloat(cs.marginTop) || 0,
    mb: parseFloat(cs.marginBottom) || 0,
    pt: parseFloat(cs.paddingTop) || 0,
    pb: parseFloat(cs.paddingBottom) || 0,
  }
}

const FOLD_PROPS = ['boxSizing', 'overflow', 'overflowAnchor', 'height', 'marginTop', 'marginBottom', 'paddingTop', 'paddingBottom', 'opacity'] as const

const setBox = (b: Box, k: number): void => {
  const s = b.el.style
  s.boxSizing = 'border-box'
  s.overflow = 'hidden'
  // Сворачивающееся место не должно служить якорем прокрутки Chrome: иначе браузер сам
  // подкручивал бы экран вслед за ним.
  s.overflowAnchor = 'none'
  s.height = `${(b.h * k).toFixed(2)}px`
  s.marginTop = `${(b.mt * k).toFixed(2)}px`
  s.marginBottom = `${(b.mb * k).toFixed(2)}px`
  s.paddingTop = `${(b.pt * k).toFixed(2)}px`
  s.paddingBottom = `${(b.pb * k).toFixed(2)}px`
  // Заголовок секции гаснет быстрее, чем уходит место: иначе его срезало бы по высоте.
  s.opacity = String(clamp(k * 2 - 1, 0, 1))
}

const clearBox = (el: HTMLElement): void => {
  for (const p of FOLD_PROPS) el.style[p] = ''
}

/**
 * Отступ следующего соседа после того, как свёрнутое уберут из дерева: соседние селекторы
 * (`.card + .section-title`) дают ему другой отступ, и без этого в момент удаления список
 * прыгал бы на него. Узнать можно только вынув свёрнутое на миг, в том же кадре.
 */
const marginWithout = (fold: HTMLElement[], next: HTMLElement): number => {
  const first = fold[0]
  const parent = first?.parentNode
  if (!parent) return parseFloat(getComputedStyle(next).marginTop) || 0
  const anchor = fold[fold.length - 1]!.nextSibling
  // Замер отступа считает раскладку, и без секции страница короче: у низа браузер поджал
  // бы прокрутку, и после возврата секции экран остался бы уехавшим вверх.
  const y = window.scrollY
  for (const el of fold) el.remove()
  const m = parseFloat(getComputedStyle(next).marginTop) || 0
  for (const el of fold) parent.insertBefore(el, anchor)
  if (window.scrollY !== y) window.scrollTo(0, y)
  return m
}

type Fold = { boxes: Box[]; next: HTMLElement | null; nextFrom: number; nextTo: number }

const measureFold = (fold: HTMLElement[]): Fold => {
  const boxes = fold.map(boxOf)
  const next = fold[fold.length - 1]!.nextElementSibling as HTMLElement | null
  const nextFrom = next ? parseFloat(getComputedStyle(next).marginTop) || 0 : 0
  const nextTo = next ? marginWithout(fold, next) : 0
  return { boxes, next, nextFrom, nextTo }
}

/** k: 1 - место раскрыто, 0 - свёрнуто. */
const paintFold = (f: Fold, k: number): void => {
  for (const b of f.boxes) setBox(b, k)
  if (f.next && f.nextFrom !== f.nextTo) f.next.style.marginTop = `${(f.nextTo + (f.nextFrom - f.nextTo) * k).toFixed(2)}px`
}

const clearFold = (f: Fold): void => {
  for (const b of f.boxes) clearBox(b.el)
  if (f.next) f.next.style.marginTop = ''
}

const runFold = (f: Fold, from: number, to: number, delay: number): Promise<void> =>
  new Promise((resolve) => {
    animate(
      delay + FOLD_MS,
      (t) => paintFold(f, from + (to - from) * pr(t, delay, FOLD_MS, E.crisp)),
      resolve,
    )
  })

/**
 * Свёрнутое место держит инлайн-отступ соседа, пока данные не уберут строку из дерева:
 * потом он снимается, иначе остался бы чужим, когда секция вернётся.
 */
const releaseWhenGone = (f: Fold): void => {
  const t0 = performance.now()
  const check = (): void => {
    const gone = !f.boxes[0]?.el.isConnected
    if (gone || performance.now() - t0 > 10_000) {
      if (gone && f.next) f.next.style.marginTop = ''
      return
    }
    requestAnimationFrame(check)
  }
  requestAnimationFrame(check)
}

// --- снаружи -------------------------------------------------------------------------------

/**
 * Что сворачивать вместе со строкой. Строка одна в карточке - рассыпается карточка; карточка
 * одна под своим заголовком - уходит вся секция. Иначе строка уходит вместе с одним
 * разделителем, чтобы два не встали подряд.
 */
export function foldOf(row: HTMLElement): { target: HTMLElement; fold: HTMLElement[] } {
  const parent = row.parentElement
  const rows = parent ? Array.from(parent.children).filter((c) => !c.classList.contains('sep')) : []
  const target = parent?.classList.contains('card') && rows.length === 1 ? parent : row
  if (target.classList.contains('card')) {
    const title = target.previousElementSibling as HTMLElement | null
    const alone = title?.classList.contains('section-title') && !target.nextElementSibling?.classList.contains('card')
    return { target, fold: alone ? [title!, target] : [target] }
  }
  const next = row.nextElementSibling as HTMLElement | null
  const prev = row.previousElementSibling as HTMLElement | null
  if (next?.classList.contains('sep')) return { target, fold: [row, next] }
  if (prev?.classList.contains('sep')) return { target, fold: [prev, row] }
  return { target, fold: [row] }
}

export type Vanish = {
  /** Место свернулось: строку можно убирать из данных, ничего не прыгнет. */
  folded: Promise<void>
  /** Точки строки, чтобы «Вернуть» собрало её обратно. */
  dust: Promise<Dust | null>
  /** Сервер отказал: место раскрывается, и строка собирается обратно там же. */
  back: () => Promise<void>
}

/**
 * Строка рассыпается, её место сворачивается. Строка уходит из данных после `folded`: до
 * этого вызывающий держит её в списке. Без движения (слабый Android, «уменьшение
 * движения») место сворачивается сразу.
 */
export function vanish(row: HTMLElement): Vanish {
  const { target, fold } = foldOf(row)
  const dustP = capture(target)
  let f: Fold | null = null
  let flying: Promise<void> = Promise.resolve()
  let origin = { left: 0, top: 0 }
  const folded = (async () => {
    const dust = await dustP
    const rb = target.getBoundingClientRect()
    origin = { left: rb.left, top: rb.top }
    f = measureFold(fold)
    target.style.visibility = 'hidden'
    if (dust) flying = fly(dust, origin.left, origin.top, 0, DUST_MS, DUST_MS, (p) => p)
    await runFold(f, 1, 0, dust ? FOLD_DELAY : 0)
    foldedAt = performance.now()
    releaseWhenGone(f)
  })()
  return {
    folded,
    dust: dustP,
    back: async () => {
      await folded
      await flying
      const dust = await dustP
      if (!f || !target.isConnected) return
      await runFold(f, 0, 1, 0)
      if (dust) {
        const rb = target.getBoundingClientRect()
        await fly(dust, rb.left, rb.top, BACK_FROM, 0, BACK_MS, E.crisp)
      }
      clearFold(f)
      target.style.visibility = ''
    },
  }
}

/** Когда последний раз свернулось место рассыпавшейся строки. */
let foldedAt = -Infinity
/** Пустое состояние, смонтированное позже этого после свёртки, встало не из-за неё. */
const GROW_WINDOW_MS = 1500

/**
 * Ref пустого состояния («Нет заявок»), которое встаёт на место последней рассыпавшейся
 * строки: оно вырастает из нуля следом за свёрткой, а не появляется рывком. Смонтированное
 * по другой причине (открыли пустой день) встаёт без движения. Метка `data-dust-empty` на
 * том же узле нужна «Вернуть»: перед возвратом строки оно сворачивается (foldOut).
 */
export const growIn = (el: HTMLElement | null): void => {
  if (!el || reducedMotion() || performance.now() - foldedAt > GROW_WINDOW_MS) return
  const f = measureFold([el])
  paintFold(f, 0)
  void runFold(f, 0, 1, 0).then(() => clearFold(f))
}

/**
 * Сворачивает место на глазах (пустое состояние перед возвратом строки). Вернувшаяся
 * функция раскрывает его обратно без движения, если оно так и осталось на экране.
 */
export async function foldOut(el: HTMLElement): Promise<() => void> {
  if (reducedMotion()) return () => {}
  const f = measureFold([el])
  await runFold(f, 1, 0, 0)
  return () => clearFold(f)
}

/**
 * Точки без сворачивания: содержимое сменилось на месте (стёрли текст заметки), а место
 * под ним остаётся. `back` - сборка: содержимое уже вернулось и прячется, пока летят точки.
 */
export function scatter(el: HTMLElement, dust: Dust, back = false): void {
  const rb = el.getBoundingClientRect()
  if (!back) {
    void fly(dust, rb.left, rb.top, 0, DUST_MS, DUST_MS, (p) => p)
    return
  }
  el.style.visibility = 'hidden'
  void fly(dust, rb.left, rb.top, BACK_FROM, 0, BACK_MS, E.crisp).then(() => {
    el.style.visibility = ''
  })
}

/**
 * «Вернуть»: строка уже снова в дереве (данные обновлены синхронно), её место раскрывается
 * из нуля, и точки собираются в неё. Зовётся в том же кадре, что и подмена данных, до
 * отрисовки, иначе строка мелькнула бы целиком.
 */
export function reappear(row: HTMLElement, dust: Dust | null): Promise<void> {
  const { target, fold } = foldOf(row)
  // Сосед сейчас стоит с отступом «строка есть», а раскрываться место будет от «строки нет».
  const f = measureFold(fold)
  paintFold(f, 0)
  target.style.visibility = 'hidden'
  return (async () => {
    await runFold(f, 0, 1, 0)
    if (dust) {
      const rb = target.getBoundingClientRect()
      await fly(dust, rb.left, rb.top, BACK_FROM, 0, BACK_MS, E.crisp)
    }
    clearFold(f)
    target.style.visibility = ''
  })()
}
