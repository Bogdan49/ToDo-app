// Клиент для собственного Supabase-проекта пользователя.
// Используется для работы с таблицей tasks вместо Lovable Cloud.
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://fqcejzrraazgxxfgnybo.supabase.co";
const SUPABASE_PUBLISHABLE_KEY =
  "sb_publishable_KU2fNUfFgpmrEQauyhkFsw_4am1IFqN";

export const userSupabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    storage: typeof window !== "undefined" ? localStorage : undefined,
    persistSession: true,
    autoRefreshToken: true,
    storageKey: "user-supabase-auth",
  },
});
