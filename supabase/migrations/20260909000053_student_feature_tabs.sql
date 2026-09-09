-- 학생 화면 탭 노출을 강사가 정한다 — 파생·헷지 / 예금.
--
-- [왜] 학생 화면 모드 탭이 3개(주식 매매·파생·헷지·예금)가 됐다. "파생·헷지"는 청소년에게
-- 설명 없이는 의미 없는 단어고, 안 가르친 반에서 학생이 옵션을 잘못 사면 UI 문제가 아니라
-- 교육 사고다. 그래서 flat_pricing(0050·0051)과 같은 원리로 — 강사가 학생에게 보여줄
-- 복잡도를 정한다.
--
-- [기본값 true] 지금 동작을 그대로 둔다(업그레이드로 화면이 조용히 바뀌지 않게).
-- 초보 대상 반은 강사가 꺼서 2탭·1탭으로 단순화한다.
--
-- [진행 중에도 변경] 3라운드에서 옵션을 가르치고 그때 켜는 흐름이 자연스럽다.
-- 그래서 admin_update_game_config(시작 전 전용)가 아니라 별도 RPC로 둔다 —
-- 이 두 값을 세우는 곳은 이 함수 하나뿐이다.

alter table game_state add column if not exists enable_options boolean not null default true;
alter table game_state add column if not exists enable_savings boolean not null default true;

comment on column game_state.enable_options is
  'false면 학생 화면에서 [파생·헷지] 탭을 숨긴다. 서버 place_option_order 자체는 막지 않는다 — 화면 구성용.';
comment on column game_state.enable_savings is
  'false면 학생 화면에서 [예금] 탭을 숨긴다. 이미 가입한 예금의 이자·평가금액 반영은 그대로 진행된다.';

-- ─────────────────────────────────────────────
-- 학생 탭 노출 설정 — null이면 그 값은 건드리지 않는다.
-- ─────────────────────────────────────────────
create or replace function admin_set_student_features(
  p_admin_secret text,
  p_enable_options boolean default null,
  p_enable_savings boolean default null
)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_opt boolean;
  v_sav boolean;
begin
  if not private.verify_admin(p_admin_secret) then
    return jsonb_build_object('ok', false, 'error', 'unauthorized');
  end if;

  update game_state set
    enable_options = coalesce(p_enable_options, enable_options),
    enable_savings = coalesce(p_enable_savings, enable_savings)
  where id = 1
  returning enable_options, enable_savings into v_opt, v_sav;

  -- 학생 App.jsx는 stocks_changed에 refetch → game 갱신 → 탭이 즉시 나타나거나 사라진다
  perform emit_signal('stocks_changed',
    jsonb_build_object('enable_options', v_opt, 'enable_savings', v_sav));

  return jsonb_build_object('ok', true, 'enable_options', v_opt, 'enable_savings', v_sav);
end;
$$;

grant execute on function admin_set_student_features(text, boolean, boolean) to anon, authenticated;
