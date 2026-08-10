// ============================================================
// Configuración del panel web VentaBox
// Edita estos dos valores ANTES de desplegar en Netlify/Vercel.
// ============================================================

// URL de tu proyecto Supabase, ej: "https://abcd1234.supabase.co"
const SUPABASE_URL = "https://blgdawgldvokfnfhmeqe.supabase.co";

// URL de la edge function, ej: "https://abcd1234.supabase.co/functions/v1/consulta"
const FUNCTION_URL = SUPABASE_URL ? SUPABASE_URL + "/functions/v1/consulta" : "";

// Clave "anon public" (Settings → API). NO es un secreto: es pública por diseño.
// Supabase la exige en el header Authorization aunque la función valide con PIN.
const ANON_KEY = "sb_publishable_wBqDtHQBeTQz4bQNLlN3Qw_k1mr9JwK";
