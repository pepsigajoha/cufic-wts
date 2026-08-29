-- 주가 시뮬레이터(관리자 전용): sim_sandbox에서 검증한 7요인 확률과정 엔진을
-- src/admin/priceSim.js로 그대로 이식했다. 계산은 브라우저(클라이언트)에서 하고,
-- 이 RPC는 그 결과 { [stock_id]: { [year]: price } }를 받아 stocks.prices에
-- 원자적으로 반영하는 역할만 한다(계산 로직 없음 — admin_upsert_stock과 동일하게
-- prices는 "교체"이지 "병합"이 아니다).
--
-- 여러 종목을 한 트랜잭션으로 묶는 이유: 종목별로 admin_upsert_stock을 N번 호출하면
-- 중간에 실패했을 때 일부 종목만 새 가격, 나머지는 옛 가격인 채로 학생 화면에 노출될
-- 수 있다(그리기 시뮬레이션 특성상 "세트로 생성된" 가격이 부분 반영되면 데이터 정합성
-- 사고로 이어지기 쉽다).
--
-- 존재하지 않는 stock_id는 조용히 무시한다(에러로 막지 않음). 대신 applied/requested
-- 건수를 함께 돌려줘서 프론트가 불일치를 감지·경고할 수 있게 한다.
create or replace function admin_apply_simulated_prices(p_admin_secret text, p_prices jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_applied int;
  v_requested int;
begin
  if not private.verify_admin(p_admin_secret) then
    return jsonb_build_object('ok', false, 'error', 'unauthorized');
  end if;
  if p_prices is null or jsonb_typeof(p_prices) <> 'object' or p_prices = '{}'::jsonb then
    return jsonb_build_object('ok', false, 'error', 'invalid_payload');
  end if;

  select count(*) into v_requested from jsonb_object_keys(p_prices);

  update stocks s
    set prices = p_prices -> s.id
  where s.id in (select jsonb_object_keys(p_prices));
  get diagnostics v_applied = row_count;

  perform emit_signal('stocks_changed', jsonb_build_object('source', 'simulator', 'applied', v_applied));
  return jsonb_build_object('ok', true, 'applied', v_applied, 'requested', v_requested);
end;
$$;

grant execute on function admin_apply_simulated_prices(text, jsonb) to anon, authenticated;
