import { createRoot } from 'react-dom/client'
import './app.css'
import { Root } from './Root'
import { applyTheme, loadTheme } from './theme'

// Тему ставим до первой отрисовки — иначе моргнёт светлым на тёмной теме.
applyTheme(loadTheme())

createRoot(document.getElementById('app')!).render(<Root />)
