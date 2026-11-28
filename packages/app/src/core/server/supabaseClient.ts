// src/core/server/supabaseClient.ts

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

function createNoopQueryBuilder() {
  const result = Promise.resolve({ data: [], error: null, count: 0 });
  const builder: Record<string, unknown> = {
    then: result.then.bind(result),
    catch: result.catch.bind(result),
    finally: result.finally.bind(result),
    single: async () => ({ data: null, error: null }),
    maybeSingle: async () => ({ data: null, error: null }),
  };
  for (const method of [
    'select', 'insert', 'update', 'upsert', 'delete',
    'eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'like', 'ilike',
    'in', 'is', 'order', 'limit', 'range', 'filter', 'match',
  ]) {
    builder[method] = () => builder;
  }
  return builder;
}

function createSupabaseStub(): SupabaseClient {
  return {
    auth: {
      getSession: async () => ({ data: { session: null }, error: null }),
      getUser: async () => ({ data: { user: null }, error: null }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
      signInAnonymously: async () => ({ data: { user: null, session: null }, error: null }),
      signInWithOAuth: async () => ({
        data: { provider: 'github', url: '' },
        error: new Error('Supabase credentials are not configured.'),
      }),
      signOut: async () => ({ error: null }),
      setSession: async () => ({ data: { user: null, session: null }, error: null }),
      exchangeCodeForSession: async () => ({ data: { user: null, session: null }, error: null }),
    },
    from: () => createNoopQueryBuilder(),
    rpc: async () => ({ data: null, error: null }),
    storage: {
      from: () => ({
        getPublicUrl: (path: string) => ({ data: { publicUrl: path } }),
      }),
    },
  } as unknown as SupabaseClient;
}

function isValidHttpUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  if (!/^https?:\/\//i.test(trimmed)) return false;
  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function createSafeSupabaseClient(): SupabaseClient {
  if (!isValidHttpUrl(supabaseUrl) || !supabaseAnonKey || !String(supabaseAnonKey).trim()) {
    console.warn("Supabase credentials are missing or invalid! Running with offline Supabase stub.");
    return createSupabaseStub();
  }
  try {
    return createClient(supabaseUrl.trim(), String(supabaseAnonKey).trim());
  } catch (err) {
    console.warn("Failed to initialize Supabase client; running with offline stub.", err);
    return createSupabaseStub();
  }
}

export const supabase: SupabaseClient = createSafeSupabaseClient();