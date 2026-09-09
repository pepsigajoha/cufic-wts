import { useEffect, useState } from 'react'
import Modal from '../components/Modal'
import { errorText } from '../supabase'
// datasetXlsx(SheetJS 포함)은 무거워 클릭 시 동적 import 한다(학생 번들 미영향)

/**
 * 데이터셋(시나리오) — 저장·전환·백업.
 * "지금 편집 중인 데이터셋"(game.active_dataset_id)을 보여주고, 다른 탭에서 콘텐츠를 고친 뒤
 * [저장]을 누르면 그 데이터셋에 반영된다. [편집]으로 다른 데이터셋으로 전환(불러오기, 게임 리셋).
 */
export default function AdminDatasets({ actions, game, refresh, notify, dirty, onSaved }) {
  const [datasets, setDatasets] = useState([])
  const [name, setName] = useState('')
  const [desc, setDesc] = useState('')
  const [busy, setBusy] = useState(false)
  const [confirm, setConfirm] = useState(null) // {type:'load'|'delete', id, name}
  const [xlsxReport, setXlsxReport] = useState(null) // { payload, errors, warnings }
  const [newName, setNewName] = useState('') // 엑셀로 만들 새 데이터셋 이름
  // 새 데이터셋 만들기 위저드 — null이면 닫힘, 0..3이 단계.
  // 양식 받기 → 파일 올리기 → 검사 결과 → 이름 짓기. 기존 핸들러를 순서대로 세운 것뿐이다.
  const [wiz, setWiz] = useState(null)

  const started = (game?.current_round ?? 0) > 0
  const activeId = game?.active_dataset_id ?? null
  const active = datasets.find((d) => d.id === activeId) ?? null

  const loadDatasets = async () => {
    const r = await actions.listDatasets()
    if (r.ok) setDatasets(r.datasets ?? [])
  }
  useEffect(() => {
    loadDatasets()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 지금 콘텐츠를 편집 중인 데이터셋에 저장(덮어쓰기)
  const saveActive = async () => {
    if (!active) return
    setBusy(true)
    const r = await actions.saveDataset(active.name, active.description, active.id)
    setBusy(false)
    if (!r.ok) return notify(errorText(r.error), 'down')
    notify(`'${active.name}'에 저장했어요`, 'gold')
    onSaved?.()
    loadDatasets()
    await refresh()
  }

  // 지금 콘텐츠를 새 데이터셋으로 저장(그게 편집 중이 됨)
  const saveNew = async () => {
    const nm = name.trim()
    if (!nm) return
    setBusy(true)
    const r = await actions.saveDataset(nm, desc)
    setBusy(false)
    if (!r.ok) return notify(errorText(r.error), 'down')
    setName('')
    setDesc('')
    notify(`'${nm}' 새 데이터셋으로 저장했어요`, 'gold')
    onSaved?.()
    loadDatasets()
    await refresh()
  }

  const exportDs = async (d) => {
    const r = await actions.getDataset(d.id)
    if (!r.ok) return notify(errorText(r.error), 'down')
    const blob = new Blob([JSON.stringify(r.payload, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${d.name}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  // 빈 양식(.xlsx) — 헤더 + 예시 2줄만. 처음부터 만들 때.
  const downloadBlank = async () => {
    const { buildBlankWorkbook } = await import('./datasetXlsx')
    const blob = new Blob([buildBlankWorkbook()], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = '데이터셋_빈양식.xlsx'
    a.click()
    URL.revokeObjectURL(url)
  }

  const onImport = async (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    let payload
    try {
      payload = JSON.parse(await file.text())
    } catch {
      return notify('JSON 파일을 읽을 수 없어요', 'down')
    }
    const nm = file.name.replace(/\.json$/i, '')
    setBusy(true)
    const r = await actions.importDataset(nm, '가져온 데이터셋', payload)
    setBusy(false)
    if (!r.ok) return notify(errorText(r.error), 'down')
    notify(`'${nm}' 가져왔어요. [편집]으로 열 수 있어요`, 'gold')
    loadDatasets()
  }

  // 엑셀 업로드(.xlsx) → 시트 5개 파싱·검증 → 리포트 모달
  const onXlsxUpload = async (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setBusy(true)
    try {
      const buf = await file.arrayBuffer()
      const { parseWorkbook } = await import('./datasetXlsx')
      const { payload, errors, warnings, infos } = parseWorkbook(buf)
      setNewName(file.name.replace(/\.xlsx$/i, ''))
      setXlsxReport({ payload, errors, warnings, infos })
      // 위저드로 올린 거면 리포트 모달 대신 다음 단계(검사 결과)로 넘어간다
      setWiz((w) => (w == null ? w : 2))
    } catch (err) {
      notify('엑셀 파일을 읽을 수 없어요', 'down')
    } finally {
      setBusy(false)
    }
  }

  // 검증 통과분을 새 데이터셋으로 생성(에러 없으면 경고가 있어도 가능, 기존 덮어쓰기 아님)
  const createFromXlsx = async () => {
    const nm = newName.trim()
    if (!nm || !xlsxReport?.payload) return
    setBusy(true)
    const r = await actions.importDataset(nm, '엑셀 양식으로 가져온 데이터셋', xlsxReport.payload)
    setBusy(false)
    if (!r.ok) return notify(errorText(r.error), 'down')
    setXlsxReport(null)
    setNewName('')
    setWiz(null)
    notify(`'${nm}' 엑셀로 만들었어요`, 'gold')
    loadDatasets()
  }

  const closeWiz = () => {
    setWiz(null)
    setXlsxReport(null)
    setNewName('')
  }

  // 데이터셋을 공식 양식(.xlsx)으로 내보내기
  const exportXlsx = async (d) => {
    setBusy(true)
    const r = await actions.getDataset(d.id)
    if (!r.ok) {
      setBusy(false)
      return notify(errorText(r.error), 'down')
    }
    const { buildWorkbook } = await import('./datasetXlsx')
    setBusy(false)
    const blob = new Blob([buildWorkbook(r.payload)], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${d.name}.xlsx`
    a.click()
    URL.revokeObjectURL(url)
  }

  const runConfirm = async () => {
    const c = confirm
    setConfirm(null)
    if (!c) return
    if (c.type === 'overwrite') return saveActive() // 덮어쓰기 확인 후 저장
    setBusy(true)
    const r = c.type === 'load' ? await actions.loadDataset(c.id) : await actions.deleteDataset(c.id)
    setBusy(false)
    if (!r.ok) return notify(errorText(r.error), 'down')
    if (c.type === 'load') {
      notify(`'${c.name}' 편집을 시작해요`, 'gold')
      onSaved?.() // 불러오면 라이브 = 그 데이터셋 → dirty 해제
    } else notify(`'${c.name}' 삭제했어요`, 'gold')
    loadDatasets()
    await refresh()
  }

  return (
    <div className="apanel">
      <section className="acard">
        <span className="acap">데이터셋 · 시나리오 저장·전환·백업</span>

        {/* 지금 편집 중 */}
        <div className={'ds-active' + (dirty ? ' dirty' : '')}>
          <div className="ds-active-info">
            <span className="ds-active-label">지금 편집 중</span>
            <span className="ds-active-name">
              {active ? active.name : '(아직 저장 안 함)'}
              {dirty && <span className="ds-dirty">● 저장 안 된 변경</span>}
            </span>
            <span className="anote ds-active-hint">
              {dirty
                ? '다른 탭에서 콘텐츠를 고쳤어요. [저장]을 눌러야 이 데이터셋에 반영됩니다 — 저장 전 [편집]으로 전환하면 사라져요.'
                : '다른 탭에서 콘텐츠(종목·가격·재무·시황·힌트·게임설정)를 고친 뒤 여기 [저장]을 누르면 이 데이터셋에 반영돼요.'}
            </span>
          </div>
          <button
            className="act-btn prime"
            disabled={busy || !active}
            onClick={() => setConfirm({ type: 'overwrite', id: active.id, name: active.name })}
          >
            💾 저장
          </button>
        </div>

        {/* 처음 만드는 사람을 위한 정문 — 양식 받기부터 생성까지 한 단계씩 */}
        <button className="act-btn prime ds-wiz-open" disabled={busy} onClick={() => setWiz(0)}>
          ✨ 엑셀로 새 데이터셋 만들기
        </button>
        <p className="anote ds-wiz-hint">
          양식 받기 → 채우기 → 올리기 → 검사 → 생성을 한 단계씩 안내해요. 처음이라면 이걸 쓰세요.
        </p>

        {/* 익숙한 사람용 — 개별 버튼은 접어 둔다 */}
        <details className="ds-adv">
          <summary className="acap">직접 하기 (저장 · 받기 · 올리기)</summary>

        {/* 새 데이터셋으로 저장 + 파일 */}
        <div className="ds-save">
          <input
            className="bc-input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="새 데이터셋 이름 (예: 2026 시나리오)"
            maxLength={60}
          />
          <input
            className="bc-input"
            value={desc}
            onChange={(e) => setDesc(e.target.value)}
            placeholder="설명 (선택)"
            maxLength={120}
          />
          <button className="act-btn bc-go" disabled={busy || !name.trim()} onClick={saveNew}>
            + 새 데이터셋으로 저장
          </button>
        </div>
        {/* 받기: 편집 중 데이터셋을 양식(.xlsx)·데이터(.json)로 바로 다운로드 */}
        <div className="ds-import">
          <span className="ds-import-label">받기</span>
          <button className="text-btn" onClick={downloadBlank}>
            📄 빈 양식 (.xlsx)
          </button>
          <button className="text-btn" disabled={busy || !active} onClick={() => exportXlsx(active)}>
            📊 양식 다운로드 (예시 채움 .xlsx)
          </button>
          <button className="text-btn" disabled={busy || !active} onClick={() => exportDs(active)}>
            📁 데이터 다운로드 (.json)
          </button>
        </div>
        {/* 올리기 */}
        <div className="ds-import">
          <span className="ds-import-label">올리기</span>
          <label className="text-btn file-btn">
            📊 엑셀 업로드 (.xlsx)
            <input
              type="file"
              accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              onChange={onXlsxUpload}
              hidden
            />
          </label>
          <label className="text-btn file-btn">
            📁 JSON 가져오기
            <input type="file" accept="application/json,.json" onChange={onImport} hidden />
          </label>
        </div>
        <p className="anote">
          <b>[양식 다운로드]</b>로 지금 편집 중인 데이터셋을 엑셀로 받아 고친 뒤, <b>[📊 엑셀 업로드]</b>로 올리면
          검사 후 새 데이터셋이 됩니다. (목록 각 행의 [엑셀]/[JSON]으로 특정 데이터셋만 받을 수도 있어요.)
        </p>
        </details>

        {started && (
          <p className="awarn">
            게임 진행 중이라 다른 데이터셋으로 [편집] 전환이 잠겨 있어요. [진행] 탭에서 게임 리셋 후 가능합니다.
          </p>
        )}

        {datasets.length === 0 ? (
          <p className="aempty">저장된 데이터셋이 없어요.</p>
        ) : (
          <div className="ds-list">
            {datasets.map((d) => (
              <div key={d.id} className={'ds-row' + (d.id === activeId ? ' on' : '')}>
                <div className="ds-info">
                  <span className="ds-name">
                    {d.name}
                    {d.id === activeId && <span className="ds-badge">편집 중</span>}
                  </span>
                  {d.description && <span className="ds-desc">{d.description}</span>}
                </div>
                <div className="ds-btns">
                  <button
                    className="act-btn buy sm"
                    disabled={busy || started || d.id === activeId}
                    onClick={() => setConfirm({ type: 'load', id: d.id, name: d.name })}
                  >
                    편집
                  </button>
                  <button className="text-btn" disabled={busy} onClick={() => exportXlsx(d)}>
                    엑셀
                  </button>
                  <button className="text-btn" disabled={busy} onClick={() => exportDs(d)}>
                    JSON
                  </button>
                  <button
                    className="text-btn danger tiny"
                    disabled={busy}
                    onClick={() => setConfirm({ type: 'delete', id: d.id, name: d.name })}
                  >
                    삭제
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <Modal
        open={!!confirm}
        onClose={() => setConfirm(null)}
        title={
          confirm?.type === 'load'
            ? '데이터셋 편집 전환'
            : confirm?.type === 'overwrite'
              ? '데이터셋 덮어쓰기'
              : '데이터셋 삭제'
        }
      >
        <div className="confirm">
          {confirm?.type === 'load' ? (
            <>
              <p className="big">
                <b>'{confirm?.name}'</b> 편집을 시작합니다
              </p>
              <p className="ask">
                지금 콘텐츠가 이 데이터셋으로 <b>바뀌고 게임이 리셋</b>됩니다(조는 유지). <b>저장하지 않은
                변경은 사라져요.</b>
              </p>
            </>
          ) : confirm?.type === 'overwrite' ? (
            <>
              <p className="big">
                <b>'{confirm?.name}'</b>에 덮어씁니다
              </p>
              <p className="ask">
                이 데이터셋의 저장 내용이 <b>지금 콘텐츠로 교체</b>됩니다(원래 내용은 사라짐).
                따로 남기려면 대신 [+ 새 데이터셋으로 저장]을 쓰세요.
              </p>
            </>
          ) : (
            <p className="big">
              <b>'{confirm?.name}'</b>을 삭제할까요?
            </p>
          )}
        </div>
        <div className="mfoot">
          <button className="cancel" onClick={() => setConfirm(null)}>
            취소
          </button>
          <button
            className={'act-btn ' + (confirm?.type === 'delete' ? 'danger' : 'prime')}
            disabled={busy}
            onClick={runConfirm}
          >
            {confirm?.type === 'load' ? '편집 시작' : confirm?.type === 'overwrite' ? '덮어쓰기' : '삭제'}
          </button>
        </div>
      </Modal>

      <DatasetWizard
        step={wiz}
        setStep={setWiz}
        onClose={closeWiz}
        active={active}
        busy={busy}
        report={xlsxReport}
        name={newName}
        setName={setNewName}
        onBlank={downloadBlank}
        onExampleXlsx={() => exportXlsx(active)}
        onUpload={onXlsxUpload}
        onCreate={createFromXlsx}
      />

      {/* 엑셀 업로드 검사 결과 — 위저드 밖에서 직접 올렸을 때만(위저드는 3단계로 보여준다) */}
      <Modal
        open={!!xlsxReport && wiz == null}
        onClose={() => setXlsxReport(null)}
        title="엑셀 검사 결과"
        wide
      >
        {xlsxReport?.errors?.length > 0 ? (
          <p className="awarn">문제(에러) {xlsxReport.errors.length}건 — 고쳐서 다시 올려주세요.</p>
        ) : (
          <p className="aok">
            검사 통과 ✅
            {xlsxReport?.warnings?.length ? ` · 경고 ${xlsxReport.warnings.length}` : ''}
            {xlsxReport?.infos?.length ? ` · 참고 ${xlsxReport.infos.length}` : ''} — 새 데이터셋으로 만들 이름을 정하세요.
          </p>
        )}
        {(xlsxReport?.errors?.length > 0 ||
          xlsxReport?.warnings?.length > 0 ||
          xlsxReport?.infos?.length > 0) && (
          <ul className="issue-list">
            {(xlsxReport?.errors ?? []).map((e, i) => (
              <li key={'e' + i} className="issue error">
                <span className="ilv">
                  {e.sheet}
                  {e.row ? ` ${e.row}행` : ''}
                </span>
                {e.msg}
              </li>
            ))}
            {(xlsxReport?.warnings ?? []).map((w, i) => (
              <li key={'w' + i} className="issue warn">
                <span className="ilv">
                  {w.sheet}
                  {w.row ? ` ${w.row}행` : ''}
                </span>
                {w.msg}
              </li>
            ))}
            {(xlsxReport?.infos ?? []).map((f, i) => (
              <li key={'i' + i} className="issue info">
                <span className="ilv">
                  {f.sheet}
                  {f.row ? ` ${f.row}행` : ''}
                </span>
                {f.msg}
              </li>
            ))}
          </ul>
        )}
        {xlsxReport?.payload && (
          <input
            className="bc-input"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="새 데이터셋 이름 (예: 2026 시나리오)"
            maxLength={60}
            autoFocus
          />
        )}
        <div className="mfoot">
          <button className="cancel" onClick={() => setXlsxReport(null)}>
            닫기
          </button>
          {xlsxReport?.payload && (
            <button className="act-btn prime" disabled={busy || !newName.trim()} onClick={createFromXlsx}>
              새 데이터셋으로 생성
            </button>
          )}
        </div>
      </Modal>
    </div>
  )
}

const WIZ_STEPS = ['양식 받기', '파일 올리기', '검사 결과', '이름 짓기']

/**
 * 새 데이터셋 만들기 위저드 — 한 화면에 결정 하나.
 *
 * 새 로직은 없다. 흩어져 있던 버튼(빈 양식·양식 다운로드·엑셀 업로드·생성)을 **실제 작업 순서대로**
 * 세운 것뿐이다. 처음 만드는 사람이 "뭐부터 눌러야 하지"에서 막히던 걸 없애는 게 목적.
 * 익숙한 사람은 위저드를 안 열고 [직접 하기]를 펼쳐 예전처럼 쓸 수 있다.
 *
 * 점·질문·네비게이션 스타일은 주가 생성기 설문(sim-wiz)과 같은 클래스를 쓴다 — 관리자 화면
 * 안에서 "단계형 흐름"의 생김새를 하나로 유지한다.
 */
function DatasetWizard({
  step,
  setStep,
  onClose,
  active,
  busy,
  report,
  name,
  setName,
  onBlank,
  onExampleXlsx,
  onUpload,
  onCreate,
}) {
  if (step == null) return null

  const errors = report?.errors ?? []
  const warnings = report?.warnings ?? []
  const infos = report?.infos ?? []
  const passed = !!report?.payload && errors.length === 0

  // 다음으로 넘어갈 수 있는지 — 단계마다 조건이 다르다
  const canNext =
    step === 0 ? true : step === 1 ? !!report : step === 2 ? passed : !!name.trim()

  return (
    <Modal open onClose={onClose} title="새 데이터셋 만들기" wide>
      <div className="ds-wiz">
        <div className="sim-wiz-dots" aria-hidden="true">
          {WIZ_STEPS.map((_, i) => (
            <span key={i} className={'d' + (i === step ? ' on' : i < step ? ' done' : '')} />
          ))}
        </div>

        {/* ① 양식 받기 */}
        {step === 0 && (
          <>
            <p className="sim-wiz-q">
              <span className="n">1/4</span>
              엑셀 양식을 받아서 채워 주세요
            </p>
            <div className="ds-wiz-picks">
              <button type="button" className="ds-wiz-pick" onClick={onBlank}>
                <span className="t">📄 빈 양식</span>
                <span className="d">헤더 + 예시 2줄만. 처음부터 새로 만들 때.</span>
              </button>
              <button
                type="button"
                className="ds-wiz-pick"
                disabled={busy || !active}
                onClick={onExampleXlsx}
              >
                <span className="t">📊 지금 데이터셋 양식</span>
                <span className="d">
                  {active
                    ? `'${active.name}'의 내용이 채워진 채로 받아서 고칠 때.`
                    : '편집 중인 데이터셋이 없어요.'}
                </span>
              </button>
            </div>
            <p className="anote ds-wiz-note">
              시트 5개(종목·가격 / 재무 / 시황 / 힌트 / 게임설정)를 채우면 돼요. 채우는 법은
              <b> 콘텐츠 제작 매뉴얼</b>을 참고하세요. 이미 채운 파일이 있으면 바로 [다음]을 누르세요.
            </p>
          </>
        )}

        {/* ② 파일 올리기 */}
        {step === 1 && (
          <>
            <p className="sim-wiz-q">
              <span className="n">2/4</span>
              채운 엑셀 파일을 올려 주세요
            </p>
            <label className="ds-wiz-drop">
              <span className="t">📊 엑셀 파일 선택 (.xlsx)</span>
              <span className="d">올리면 바로 검사해서 결과를 보여줄게요</span>
              <input
                type="file"
                accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                onChange={onUpload}
                hidden
              />
            </label>
            {busy && <p className="anote">읽는 중…</p>}
            {report && (
              <p className="aok">
                파일을 읽었어요 — [다음]에서 검사 결과를 확인하세요.
              </p>
            )}
          </>
        )}

        {/* ③ 검사 결과 */}
        {step === 2 && (
          <>
            <p className="sim-wiz-q">
              <span className="n">3/4</span>
              {passed ? '검사를 통과했어요' : '고쳐야 할 문제가 있어요'}
            </p>
            {passed ? (
              <p className="aok">
                ✅ 오류 없음
                {warnings.length ? ` · 경고 ${warnings.length}` : ''}
                {infos.length ? ` · 참고 ${infos.length}` : ''}
                {warnings.length > 0 && ' — 경고는 그대로 진행해도 되지만 한 번 확인해 보세요.'}
              </p>
            ) : (
              <p className="awarn">
                오류 {errors.length}건. 엑셀에서 고친 뒤 [← 다시 올리기]를 눌러 주세요.
              </p>
            )}
            {(errors.length > 0 || warnings.length > 0 || infos.length > 0) && (
              <ul className="issue-list ds-wiz-issues">
                {errors.map((e, i) => (
                  <li key={'e' + i} className="issue error">
                    <span className="ilv">
                      {e.sheet}
                      {e.row ? ` ${e.row}행` : ''}
                    </span>
                    {e.msg}
                  </li>
                ))}
                {warnings.map((w, i) => (
                  <li key={'w' + i} className="issue warn">
                    <span className="ilv">
                      {w.sheet}
                      {w.row ? ` ${w.row}행` : ''}
                    </span>
                    {w.msg}
                  </li>
                ))}
                {infos.map((f, i) => (
                  <li key={'i' + i} className="issue info">
                    <span className="ilv">
                      {f.sheet}
                      {f.row ? ` ${f.row}행` : ''}
                    </span>
                    {f.msg}
                  </li>
                ))}
              </ul>
            )}
          </>
        )}

        {/* ④ 이름 짓기 */}
        {step === 3 && (
          <>
            <p className="sim-wiz-q">
              <span className="n">4/4</span>
              새 데이터셋의 이름을 정해 주세요
            </p>
            <input
              className="bc-input ds-wiz-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="예: 2026 시나리오"
              maxLength={60}
              autoFocus
            />
            <p className="anote ds-wiz-note">
              <b>기존 데이터셋을 덮어쓰지 않아요</b> — 항상 새로 만들어집니다. 만든 뒤 목록에서
              [편집]을 눌러야 실제 게임 콘텐츠로 적용돼요.
            </p>
          </>
        )}

        <div className="sim-wiz-nav ds-wiz-nav">
          {step > 0 && (
            <button
              type="button"
              className="text-btn tiny"
              onClick={() => setStep(step === 2 && !passed ? 1 : step - 1)}
            >
              {step === 2 && !passed ? '← 다시 올리기' : '← 이전'}
            </button>
          )}
          <button type="button" className="text-btn tiny" onClick={onClose}>
            닫기
          </button>
          {step < 3 ? (
            <button
              type="button"
              className="act-btn prime sm"
              disabled={!canNext}
              onClick={() => setStep(step + 1)}
            >
              다음 →
            </button>
          ) : (
            <button className="act-btn prime sm" disabled={busy || !canNext} onClick={onCreate}>
              {busy ? '만드는 중…' : '데이터셋 만들기'}
            </button>
          )}
        </div>
      </div>
    </Modal>
  )
}
