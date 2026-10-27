import { createRoot } from 'react-dom/client'
import './three-setup' // extend() muss laufen, bevor das erste JSX gerendert wird
import { App } from './App'
import './style.css'

// SplitText misst Zeilen – also erst rendern, wenn die Schriften geladen sind
// (sonst bricht es mit der Ersatzschrift um und die Zeilen stimmen nicht)
Promise.all([
  document.fonts.load('400 1em "Instrument Serif"'),
  document.fonts.load('italic 400 1em "Instrument Serif"'),
  document.fonts.load('400 1em Inter'),
])
  .catch(() => {})
  .then(() => {
    // Ohne StrictMode: drei <Scroll html> legt seine React-Root in useMemo an –
    // StrictMode würde sie doppelt erzeugen und die HTML-Texte verlieren
    createRoot(document.getElementById('root')!).render(<App />)
  })
