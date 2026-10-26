/**
 * 실행 설정.
 * 프런트엔드에는 공개해도 되는 값(Supabase URL, publishable/anon 키)만 넣는다.
 * service_role 키·DB 비밀번호는 절대 VITE_ 변수로 넣지 말 것(빌드 결과에 그대로 포함됨).
 */
const env = import.meta.env;

const url = (env.VITE_SUPABASE_URL ?? '').trim();
const key = (env.VITE_SUPABASE_PUBLISHABLE_KEY ?? env.VITE_SUPABASE_ANON_KEY ?? '').trim();
const forceDemo = String(env.VITE_DEMO_MODE ?? '').toLowerCase() === 'true';

function looksLikeSecret(k: string): boolean {
  if (k.startsWith('sb_secret_')) return true;
  // 레거시 JWT 키의 role 이 service_role 인지 확인
  const parts = k.split('.');
  if (parts.length === 3) {
    try {
      const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
      return payload?.role === 'service_role';
    } catch {
      return false;
    }
  }
  return false;
}

export const config = {
  supabaseUrl: url,
  supabaseKey: key,
  /** 연결 정보가 없거나 VITE_DEMO_MODE=true 이면 데모 모드 */
  demoMode: forceDemo || !url || !key,
  /** 비밀키를 잘못 넣은 경우 앱을 멈추고 경고 */
  secretKeyMisconfigured: !!key && looksLikeSecret(key),
  basePath: env.BASE_URL,
};

/** 로그인 메일 링크가 돌아올 주소 (GitHub Pages 하위 경로 포함) */
export function authRedirectUrl(): string {
  return `${window.location.origin}${config.basePath}`;
}
