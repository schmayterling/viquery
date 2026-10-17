import { useEffect, useState } from 'react'
import type { AppInfo } from '../../shared/api'

export function App() {
  const [info, setInfo] = useState<AppInfo>()
  useEffect(() => {
    window.viquery.appInfo().then(setInfo)
  }, [])
  return <main>viquery {info?.version}</main>
}
