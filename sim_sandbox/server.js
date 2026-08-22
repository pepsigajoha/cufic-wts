'use strict'

// ============================================================
// server.js — sim_sandbox 전용 정적 파일 서버.
// Node 내장 http/fs/path 모듈만 사용한다(외부 npm 의존성 0).
// 실행: node server.js [port]   (기본 포트 8787)
// ============================================================

const http = require('node:http')
const fs = require('node:fs')
const path = require('node:path')

const PORT = Number(process.argv[2]) || 8787
const ROOT = __dirname

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
}

const server = http.createServer((req, res) => {
  const reqPath = decodeURIComponent((req.url || '/').split('?')[0])
  const relPath = reqPath === '/' ? '/index.html' : reqPath
  const filePath = path.normalize(path.join(ROOT, relPath))

  // 루트(sim_sandbox) 바깥으로의 경로 탈출 차단
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' })
    res.end('403 Forbidden')
    return
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
      res.end(`404 Not Found: ${relPath}`)
      return
    }
    const ext = path.extname(filePath)
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' })
    res.end(data)
  })
})

server.listen(PORT, () => {
  console.log(`시뮬레이션 시각화 서버 실행 중: http://localhost:${PORT}/`)
  console.log('종료하려면 Ctrl+C를 누르세요.')
})
