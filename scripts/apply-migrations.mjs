// 마이그레이션 SQL 파일을 Supabase Management API로 직접 실행한다.
// supabase CLI(db push)가 없을 때 쓰는 일회용 적용 도구.
//
// 실행:
//   node scripts/apply-migrations.mjs --ref <project-ref> --token-env <envfile> <mig.sql> [<mig2.sql> ...]
//
// - SUPABASE_ACCESS_TOKEN 은 --token-env 로 준 파일에서 읽는다(계정 스코프 PAT).
// - 각 파일을 하나의 쿼리로 통째 실행한다(멀티 스테이트먼트 허용).
// - 성공 시 supabase_migrations.schema_migrations 에 버전 기록도 시도한다(실패해도 무시).

import { readFileSync } from 'node:fs'
import { basename } from 'node:path'

const args = process.argv.slice(2)
const opt = (name) => {
  const i = args.indexOf(name)
  return i !== -1 ? args[i + 1] : null
}
const REF = opt('--ref')
const TOKEN_ENV = opt('--token-env')
const files = args.filter((a) => a.endsWith('.sql'))

if (!REF || !TOKEN_ENV || files.length === 0) {
  console.error('사용법: node scripts/apply-migrations.mjs --ref <ref> --token-env <envfile> <a.sql> [b.sql ...]')
  process.exit(1)
}

const env = Object.fromEntries(
  readFileSync(TOKEN_ENV, 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'))
    .map((l) => {
      const i = l.indexOf('=')
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()]
    }),
)
const TOKEN = env.SUPABASE_ACCESS_TOKEN
if (!TOKEN) {
  console.error(`중단: ${TOKEN_ENV} 에 SUPABASE_ACCESS_TOKEN 이 없다.`)
  process.exit(1)
}

async function runSql(query) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  })
  const text = await r.text()
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${text.slice(0, 800)}`)
  return text ? JSON.parse(text) : []
}

const version = (f) => basename(f).match(/^(\d+)_/)?.[1] ?? basename(f)
const name = (f) => basename(f).replace(/^\d+_/, '').replace(/\.sql$/, '')

async function main() {
  console.log(`대상 프로젝트: ${REF}\n`)
  for (const f of files) {
    const sql = readFileSync(f, 'utf8')
    process.stdout.write(`▶ ${basename(f)} … `)
    try {
      await runSql(sql)
      console.log('OK')
      try {
        await runSql(
          `insert into supabase_migrations.schema_migrations (version, name)
           values ('${version(f)}', '${name(f)}')
           on conflict (version) do nothing`,
        )
        console.log(`  · schema_migrations 기록: ${version(f)}`)
      } catch (e) {
        console.log(`  · schema_migrations 기록 건너뜀 (${String(e.message).slice(0, 120)})`)
      }
    } catch (e) {
      console.log('실패')
      console.error(`\n${e.message}\n`)
      process.exitCode = 1
      return
    }
  }
  console.log('\n완료.')
}

main()
