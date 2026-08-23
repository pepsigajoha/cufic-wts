-- 데이터셋(시나리오 팩) — content_packs를 완성형으로 진화.
--   · 설명(description) 추가, data→payload 이름 변경
--   · 불러오기는 게임 진행 중(current_round>0)이면 차단(리셋 후 가능)
--   · 파일 import/export(.json)로 백업·공유·인수인계
-- 팩 RPC(admin_*_pack)는 이 데이터셋 RPC로 대체한다.

alter table content_packs rename to datasets;
alter table datasets rename column data to payload;
alter table datasets add column if not exists description text not null default '';

drop function if exists admin_save_pack(text, text, bigint);
drop function if exists admin_list_packs(text);
drop function if exists admin_load_pack(text, bigint);
drop function if exists admin_delete_pack(text, bigint);

-- 현재 라이브 콘텐츠 전체를 payload로 만드는 헬퍼(내부용)
create or replace function snapshot_content()
returns jsonb
language sql stable security definer set search_path = public
as $$
  select jsonb_build_object(
    'game', (select jsonb_build_object('total_rounds', total_rounds, 'round_year_map', round_year_map,
        'default_seed', default_seed, 'final_year', final_year, 'round_duration_seconds', round_duration_seconds)
      from game_state where id = 1),
    'stocks', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', name, 'description', description,
        'sector', sector, 'listed_from_round', listed_from_round, 'prices', prices, 'display_order', display_order)
      order by display_order), '[]'::jsonb) from stocks),
    'financials', (select coalesce(jsonb_agg(jsonb_build_object('stock_id', stock_id, 'year', year, 'revenue', revenue,
        'op_income', op_income, 'net_income', net_income, 'debt_ratio', debt_ratio, 'roe', roe)), '[]'::jsonb) from financials),
    'macro', (select coalesce(jsonb_agg(jsonb_build_object('year', year, 'summary', summary, 'rate', rate, 'gdp', gdp,
        'unemployment', unemployment, 'fx', fx, 'cpi', cpi, 'oil', oil) order by year), '[]'::jsonb) from macro),
    'hints', (select coalesce(jsonb_agg(jsonb_build_object('round', round, 'grade', grade, 'headline', headline,
        'impact', impact, 'related_stock_ids', related_stock_ids)), '[]'::jsonb) from hints)
  );
$$;
revoke all on function snapshot_content() from public, anon, authenticated;

-- payload를 라이브 테이블에 적재하는 헬퍼(내부용)
create or replace function restore_content(v_data jsonb)
returns void
language plpgsql security definer set search_path = public
as $$
declare v_game jsonb := v_data -> 'game';
begin
  delete from round_snapshots where true;
  delete from trades where true;
  delete from positions where true;
  delete from hint_grants where true;
  delete from broadcasts where true;
  delete from hints where true;
  delete from financials where true;
  delete from macro where true;
  delete from stocks where true;

  insert into stocks (id, name, description, sector, listed_from_round, prices, display_order)
  select s->>'id', s->>'name', coalesce(s->>'description',''), coalesce(s->>'sector',''),
         coalesce((s->>'listed_from_round')::int,1), s->'prices', coalesce((s->>'display_order')::int,0)
  from jsonb_array_elements(v_data->'stocks') s;

  insert into financials (stock_id, year, revenue, op_income, net_income, debt_ratio, roe)
  select f->>'stock_id',(f->>'year')::int,(f->>'revenue')::bigint,(f->>'op_income')::bigint,
         (f->>'net_income')::bigint,(f->>'debt_ratio')::numeric,(f->>'roe')::numeric
  from jsonb_array_elements(v_data->'financials') f;

  insert into macro (year, summary, rate, gdp, unemployment, fx, cpi, oil)
  select (m->>'year')::int,coalesce(m->>'summary',''),(m->>'rate')::numeric,(m->>'gdp')::numeric,
         (m->>'unemployment')::numeric,(m->>'fx')::int,(m->>'cpi')::numeric,(m->>'oil')::int
  from jsonb_array_elements(v_data->'macro') m;

  insert into hints (round, grade, headline, impact, related_stock_ids)
  select (h->>'round')::int,h->>'grade',h->>'headline',h->>'impact',
         coalesce((select array_agg(v) from jsonb_array_elements_text(h->'related_stock_ids') v),'{}')
  from jsonb_array_elements(v_data->'hints') h;

  update game_state set
    total_rounds=(v_game->>'total_rounds')::int, round_year_map=v_game->'round_year_map',
    default_seed=(v_game->>'default_seed')::bigint, final_year=(v_game->>'final_year')::int,
    round_duration_seconds=coalesce((v_game->>'round_duration_seconds')::int,600),
    current_round=0, is_ended=false, is_locked=false, round_ends_at=null
  where id=1;
  update teams set cash=seed where true;
end;
$$;
revoke all on function restore_content(jsonb) from public, anon, authenticated;

-- ── 저장(현재 콘텐츠 스냅샷). p_id 주면 덮어쓰기.
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
  return jsonb_build_object('ok',true,'id',v_id);
end; $$;
grant execute on function admin_save_dataset(text, text, text, bigint) to anon, authenticated;

-- ── 목록(메타만)
create or replace function admin_list_datasets(p_admin_secret text)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not private.verify_admin(p_admin_secret) then return jsonb_build_object('ok',false,'error','unauthorized'); end if;
  return jsonb_build_object('ok',true,'datasets',coalesce((
    select jsonb_agg(jsonb_build_object('id',id,'name',name,'description',description,'created_at',created_at,'updated_at',updated_at) order by id) from datasets),'[]'::jsonb));
end; $$;
grant execute on function admin_list_datasets(text) to anon, authenticated;

-- ── 내보내기(payload 반환)
create or replace function admin_get_dataset(p_admin_secret text, p_id bigint)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_row datasets;
begin
  if not private.verify_admin(p_admin_secret) then return jsonb_build_object('ok',false,'error','unauthorized'); end if;
  select * into v_row from datasets where id=p_id;
  if v_row.id is null then return jsonb_build_object('ok',false,'error','not_found'); end if;
  return jsonb_build_object('ok',true,'name',v_row.name,'description',v_row.description,'payload',v_row.payload);
end; $$;
grant execute on function admin_get_dataset(text, bigint) to anon, authenticated;

-- ── 가져오기(.json 업로드로 새 데이터셋 등록)
create or replace function admin_import_dataset(p_admin_secret text, p_name text, p_description text, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_id bigint;
begin
  if not private.verify_admin(p_admin_secret) then return jsonb_build_object('ok',false,'error','unauthorized'); end if;
  if p_payload is null or p_payload->'stocks' is null or p_payload->'game' is null then
    return jsonb_build_object('ok',false,'error','invalid_payload');
  end if;
  insert into datasets (name, description, payload) values (p_name, coalesce(p_description,''), p_payload) returning id into v_id;
  return jsonb_build_object('ok',true,'id',v_id);
end; $$;
grant execute on function admin_import_dataset(text, text, text, jsonb) to anon, authenticated;

-- ── 불러오기(진행 중이면 차단). 콘텐츠 교체 + 게임 리셋 상태로.
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
  perform emit_signal('game_reset', jsonb_build_object('dataset', p_id));
  return jsonb_build_object('ok',true);
end; $$;
grant execute on function admin_load_dataset(text, bigint) to anon, authenticated;

-- ── 삭제
create or replace function admin_delete_dataset(p_admin_secret text, p_id bigint)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not private.verify_admin(p_admin_secret) then return jsonb_build_object('ok',false,'error','unauthorized'); end if;
  delete from datasets where id=p_id;
  return jsonb_build_object('ok',true);
end; $$;
grant execute on function admin_delete_dataset(text, bigint) to anon, authenticated;
