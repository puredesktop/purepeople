import { createRoot } from 'react-dom/client'
import { App } from './App'
import './compact-in-room.css'

// held inside another app's page: it lies flat in that page rather than as a page of its own
if (window.parent !== window.top) document.documentElement.setAttribute('data-held-in-room', '')

const rootElement = document.getElementById('root')
if (!rootElement) throw new Error('PurePeople: #root element is missing')
createRoot(rootElement).render(<App />)
