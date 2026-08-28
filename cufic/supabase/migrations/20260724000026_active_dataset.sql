-- 데이터셋 UX 직관화: "지금 편집 중인 데이터셋"을 추적한다.
--   · game_state.active_dataset_id — 마지막으로 불러오거나 저장한 데이터셋.
--   · 불러오기/저장 시 자동으로 갱신 → 화면에 "편집 중: X"를 보여주고 [저장] 한 번으로 그 데이터셋에 반영.

alter table game_state add column if not exists active_dataset_id bigint;

-- 저장: 새로 만들면 그게 활성, 덮어쓰면 그 id가 활성
create or replace function admin_save_dataset(p_admin_secret text, p_name text, p_description text, p_id bigint default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_id bigint;
begin
  if not private.verify_admin(p_admin_secret) then return jsonb_build_object('ok',false,'error','unauthorized'); end if;
  if p_id is null then
    insert into datasets (name, description, payload) values (p_name, coalesce(p_description,''), snapshot_content()) returning id into v_id;
  else
    update datasets set name=p_name, description=coalesce(p_description,''), payload=snapshot_content(), updated_at=now() where id=p_id returning id into v_id;
    if v_id is null then return jsonb_build_object('ok',false,'error','not_found'); end if;
  end if;
  update game_state set active_dataset_id = v_id where id = 1;
  return jsonb_build_object('ok',true,'id',v_id);
end; $$;
grant execute on function admin_save_dataset(text, text, text, bigint) to anon, authenticated;

-- 불러오기: 그 데이터셋이 활성(편집 중)이 된다
create or replace function admin_load_dataset(p_admin_secret text, p_id bigint)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_data jsonb; v_cur int;
begin
  if not private.verify_admin(p_admin_secret) then return jsonb_build_object('ok',false,'error','unauthorized'); end if;
  select current_round into v_cur from game_state where id=1 for update;
  if v_cur > 0 then return jsonb_build_object('ok',false,'error','game_already_started'); end if;
  select payload into v_data from datasets where id=p_id;
  if v_data is null then return jsonb_build_object('ok',false,'error','not_found'); end if;
  perform restore_content(v_data);
  update game_state set active_dataset_id = p_id where id = 1;
  perform emit_signal('game_reset', jsonb_build_object('dataset', p_id));
  return jsonb_build_object('ok',true);
end; $$;
grant execute on function admin_load_dataset(text, bigint) to anon, authenticated;

-- 삭제: 편집 중이던 걸 지우면 편집 중 표시를 비운다
create or replace function admin_delete_dataset(p_admin_secret text, p_id bigint)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not private.verify_admin(p_admin_secret) then return jsonb_build_object('ok',false,'error','unauthorized'); end if;
  delete from datasets where id=p_id;
  update game_state set active_dataset_id = null where id = 1 and active_dataset_id = p_id;
  return jsonb_build_object('ok',true);
end; $$;
grant execute on function admin_delete_dataset(text, bigint) to anon, authenticated;
