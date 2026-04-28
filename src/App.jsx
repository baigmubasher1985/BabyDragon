import { useEffect } from 'react'
import { supabase } from './lib/supabaseClient'

export default function App() {
  useEffect(() => {
    testConnection()
  }, [])

  async function testConnection() {
    const { data, error } = await supabase.from('profiles').select('*')

    console.log('DATA:', data)
    console.log('ERROR:', error)
  }

  return (
    <div style={{ padding: 40 }}>
      <h1>🐉 BabyDragon Connected</h1>
      <p>Check console (F12)</p>
    </div>
  )
}