import { config } from '../config';
import { DemoRepository } from './demoRepository';
import type { Repository } from './repository';
import { SupabaseRepository } from './supabaseRepository';

function createRepository(): Repository {
  if (config.demoMode || config.secretKeyMisconfigured) {
    const demo = new DemoRepository();
    // E2E 테스트·수동 확인용 (데모 모드에서만 노출)
    (window as unknown as { __demoRepo?: DemoRepository }).__demoRepo = demo;
    return demo;
  }
  return new SupabaseRepository(config.supabaseUrl, config.supabaseKey);
}

export const repo: Repository = createRepository();
