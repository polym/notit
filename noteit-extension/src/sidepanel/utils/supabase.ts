import { createClient, SupabaseClient } from '@supabase/supabase-js';

let client: SupabaseClient | null = null;

interface SupabaseConfig {
  url: string;
  key: string;
}

export const getSupabaseClient = async () => {
  if (client) return client;

  const result = await chrome.storage.sync.get('supabase_config');
  const config = result.supabase_config as SupabaseConfig | undefined;
  
  if (config?.url && config?.key) {
    client = createClient(config.url, config.key);
    return client;
  }
  return null;
};

export const resetSupabaseClient = () => {
  client = null;
};
