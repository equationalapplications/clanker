import { createClient } from '@supabase/supabase-js'
import { supabaseUrl, supabaseAnonKey } from './constants'

// Create a single supabase client for interacting with your database
export const supabase = createClient(supabaseUrl!, supabaseAnonKey!)