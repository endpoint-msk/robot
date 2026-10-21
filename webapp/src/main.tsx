import { createRoot } from 'react-dom/client'
import './app.css'
import { Root } from './Root'
import { lowEnd } from './motion'
import { applyTheme, loadTheme } from './theme'

// Тему ставим до первой отрисовки — иначе моргнёт светлым на тёмной теме.
applyTheme(loadTheme())
// CSS-переходы на слабом Android гасит класс (app.css, .low-motion), JS-кадры — reducedMotion.
if (lowEnd) document.documentElement.classList.add('low-motion')

createRoot(document.getElementById('app')!).render(<Root />)
