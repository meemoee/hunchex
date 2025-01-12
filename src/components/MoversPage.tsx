'use client'

import dynamic from 'next/dynamic'

const MoversListPage = dynamic(() => import('./MoversListPage'), {
  ssr: false
})

export default function MoversPage() {
  return <MoversListPage />
}