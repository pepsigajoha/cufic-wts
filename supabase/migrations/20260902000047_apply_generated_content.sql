-- 주가 생성기: 새 가격 경로에 맞춰 재무제표·힌트를 한 번에 반영한다.
-- 숫자·방향은 클라이언트(src/admin/simContent.js: deriveNextFinancials / deriveRoundHints)가
-- 결정적으로 계산해서 넘긴다. 이 함수는 검증된 값을 쓰기만 한다.

create or replace function admin_apply_generated_content(
  p_admin_secret text,
  p_financials jsonb default '[]'::jsonb,   -- [{stock_id, year, current_assets, ... 입력 7개}]
  p_hints jsonb default '[]'::jsonb,        -- [{round, grade, impact, headline, related_stock_ids}]
  p_replace_hint_rounds int[] default '{}'  -- 이 라운드들의 기존 힌트를 지우고 p_hints 로 교체
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_fin int := 0;
  v_hint int := 0;
  r jsonb;
begin
  if not private.verify_admin(p_admin_secret) then
    return jsonb_build_object('ok', false, 'error', 'unauthorized');
  end if;

  -- 재무제표: 입력 7개만 upsert (파생값은 프론트 deriveFinancials 가 계산 — DB에 저장 안 함)
  for r in select value from jsonb_array_elements(coalesce(p_financials, '[]'::jsonb)) as t(value)
  loop
    insert into financials (
      stock_id, year, current_assets, noncurrent_assets,
      current_liabilities, noncurrent_liabilities,
      revenue, operating_expense, nonoperating_expense
    ) values (
      r->>'stock_id', (r->>'year')::int,
      (r->>'current_assets')::bigint, (r->>'noncurrent_assets')::bigint,
      (r->>'current_liabilities')::bigint, (r->>'noncurrent_liabilities')::bigint,
      (r->>'revenue')::bigint, (r->>'operating_expense')::bigint, (r->>'nonoperating_expense')::bigint
    )
    on conflict (stock_id, year) do update set
      current_assets        = excluded.current_assets,
      noncurrent_assets     = excluded.noncurrent_assets,
      current_liabilities   = excluded.current_liabilities,
      noncurrent_liabilities = excluded.noncurrent_liabilities,
      revenue               = excluded.revenue,
      operating_expense     = excluded.operating_expense,
      nonoperating_expense  = excluded.nonoperating_expense;
    v_fin := v_fin + 1;
  end loop;

  -- 힌트: 지정 라운드의 기존 힌트 삭제(hint_grants 는 on delete cascade) 후 재삽입
  if array_length(p_replace_hint_rounds, 1) is not null then
    delete from hints where round = any(p_replace_hint_rounds);
  end if;
  for r in select value from jsonb_array_elements(coalesce(p_hints, '[]'::jsonb)) as t(value)
  loop
    insert into hints (round, grade, headline, impact, related_stock_ids)
    values (
      (r->>'round')::int, r->>'grade', r->>'headline', r->>'impact',
      coalesce((select array_agg(x) from jsonb_array_elements_text(r->'related_stock_ids') as e(x)), '{}')
    );
    v_hint := v_hint + 1;
  end loop;

  if v_fin > 0 then
    perform emit_signal('content_changed', jsonb_build_object('financials', v_fin));
  end if;
  if array_length(p_replace_hint_rounds, 1) is not null or v_hint > 0 then
    perform emit_signal('hints_changed', jsonb_build_object('hints', v_hint));
  end if;

  return jsonb_build_object('ok', true, 'financials', v_fin, 'hints', v_hint);
end;
$$;
grant execute on function admin_apply_generated_content(text, jsonb, jsonb, int[]) to anon, authenticated;
