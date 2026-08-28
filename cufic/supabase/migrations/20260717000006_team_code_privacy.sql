-- 참가 코드 비공개
--
-- 문제: teams에 "read using(true)" 정책이 있어 anon이 전 조의 code를 그대로 읽을 수 있었다.
--       힌트를 조별로 격리해도 코드를 알면 get_my_hints(남의 코드)로 다 뚫린다.
--       조 코드가 유일한 신원 수단인 구조에서 코드 목록 공개는 신원 전체를 공개하는 것과 같다.
--
-- 해결: teams 직접 읽기를 막고, 코드가 빠진 뷰만 연다.
--       코드 확인은 login_team RPC로만 — 맞는지 여부만 알려주고 목록은 주지 않는다.
--
-- 남는 한계: 코드를 아는 사람은 그 조로 로그인할 수 있다. 이건 코드 기반 인증의
--            본질적 성질이라 여기서 더 막을 수 없다. 진짜 격리가 필요해지면
--            Supabase Auth(JWT에 team claim)로 가야 한다 — Realtime 조별 필터링도 그때 풀린다.

drop policy if exists "read teams" on teams;

-- 리더보드·관리자 화면이 쓸 공개 정보. code 없음.
-- 뷰는 소유자 권한으로 돌아(security_invoker=false 기본) teams의 RLS를 우회한다.
create view public_teams as
  select id, name, seed, created_at from teams;

grant select on public_teams to anon, authenticated;

comment on view public_teams is
  '참가 코드를 뺀 조 목록. teams 직접 조회는 막혀 있다.';

-- ─────────────────────────────────────────────
-- 로그인 — 코드가 맞는지만 확인한다. 목록을 주지 않는다.
-- auth.js의 TODO 자리가 이걸 호출하게 된다.
-- ─────────────────────────────────────────────
create or replace function login_team(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_team teams%rowtype;
begin
  select * into v_team from teams where code = upper(trim(p_code));
  if not found then
    return jsonb_build_object('ok', false, 'error', 'unknown_code');
  end if;
  return jsonb_build_object('ok', true, 'team_id', v_team.id,
                            'code', v_team.code, 'name', v_team.name);
end;
$$;

grant execute on function login_team(text) to anon, authenticated;
