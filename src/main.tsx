import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './styles.css'

const el = document.getElementById('root')
if (!el) throw new Error('#root が見つかりません')

// StrictMode は意図的に有効にしている。
// LogicFlow は命令的 API（インスタンスを自分で作って DOM に生やす）なので
// 二重マウントで壊れやすい。開発中に必ず二重で走らせて、後始末の漏れを早く見つける。
createRoot(el).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
