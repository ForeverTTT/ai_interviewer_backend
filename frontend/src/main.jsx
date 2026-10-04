import React from 'react'
import ReactDOM from 'react-dom/client'
import './i18n/config.js'
import { installAutocapture } from './lib/autocapture'
import App from './App.jsx'
import './index.css'

// Before rendering so the first page's errors, vitals and API calls are seen.
installAutocapture()

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
