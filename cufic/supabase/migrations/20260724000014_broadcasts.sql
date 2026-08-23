-- 공통 속보 (전체 동시 공지) — 강사가 라운드 중 전 조에 한꺼번에 쏘는 한 줄 알림.
--
-- 조별 등급 힌트(hints/hint_grants)와는 별개다:
--   * 등급 힌트 → 조마다 다르게 지급, select 정책 없이 get_my_hints RPC로만 조회
--   * 속보     → 전원 공개. read 정책 using(true)로 anon이 바로 읽는다.
-- 학생 화면은 헤더 종 버튼이 깜빡이면 눌러 팝업으로 본다. 실시간은 signals('broadcast').

create table broadcasts (
  id bigint generated always as identity primary key,
  round int not null,
  headline text not null,
  created_at timestamptz default now()
);

create index broadcasts_id_idx on broadcasts (id desc);

alter table broadcasts enable row level security;
-- 전체 공개 — 속보는 모두가 본다
create policy "read broadcasts" on broadcasts for select using (true);
-- 쓰기 정책 없음 = RPC(security definer)로만. RLS 기본 거부.

-- ─────────────────────────────────────────────
-- 발송 (관리자) — 현재 라운드로 한 줄 속보를 넣고 신호를 쏜다
-- ─────────────────────────────────────────────
create or replace function admin_send_broadcast(p_admin_secret text, p_headline text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_round int;
  v_id bigint;
  v_head text := trim(coalesce(p_headline, ''));
begin
  if not private.verify_admin(p_admin_secret) then
    return jsonb_build_object('ok', false, 'error', 'unauthorized');
  end if;
  if v_head = '' then
    return jsonb_build_object('ok', false, 'error', 'empty_headline');
  end if;

  select current_round into v_round from game_state where id = 1;

  insert into broadcasts (round, headline) values (coalesce(v_round, 0), v_head)
  returning id into v_id;

  perform emit_signal('broadcast', jsonb_build_object('id', v_id));
  return jsonb_build_object('ok', true, 'id', v_id);
end;
$$;

-- ─────────────────────────────────────────────
-- 회수 (관리자) — 잘못 보낸 속보를 지운다
-- ─────────────────────────────────────────────
create or replace function admin_delete_broadcast(p_admin_secret text, p_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not private.verify_admin(p_admin_secret) then
    return jsonb_build_object('ok', false, 'error', 'unauthorized');
  end if;
  delete from broadcasts where id = p_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  perform emit_signal('broadcast', jsonb_build_object('deleted', p_id));
  return jsonb_build_object('ok', true);
end;
$$;

grant execute on function admin_send_broadcast(text, text) to anon, authenticated;
grant execute on function admin_delete_broadcast(text, bigint) to anon, authenticated;

-- ─────────────────────────────────────────────
-- reset_game — 속보도 함께 정리한다
-- ─────────────────────────────────────────────
create or replace function reset_game(p_admin_secret text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not private.verify_admin(p_admin_secret) then
    return jsonb_build_object('ok', false, 'error', 'unauthorized');
  end if;

  update game_state set is_locked = true where id = 1;

  delete from round_snapshots where true;
  delete from trades where true;
  delete from positions where true;
  delete from order_sheets where true;
  delete from hint_grants where true;
  delete from broadcasts where true;
  update teams set cash = seed where true;

  update game_state set current_round = 0, is_locked = false, round_ends_at = null where id = 1;

  perform emit_signal('game_reset', '{}'::jsonb);
  return jsonb_build_object('ok', true);
end;
$$;

grant execute on function reset_game(text) to anon, authenticated;
