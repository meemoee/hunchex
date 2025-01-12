import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatPrice(price: number | null): string {
  return price !== null && price !== undefined ? `${Math.round(price * 100)}%` : 'N/A'
}

export function formatVolumeChange(change: number, volume: number): string {
  if (change === null || isNaN(change)) return 'N/A'
  const roundedChange = Math.round(change * 100) / 100
  const sign = roundedChange >= 0 ? '+' : '-'
  const absChange = Math.abs(roundedChange)
  const volumeText = volume ? ` (${Math.round(volume).toLocaleString()} shares total)` : ''
  return `${sign}${absChange.toLocaleString()} shares${volumeText}`
}

export function roundToNDecimals(value: number, decimals: number): number {
  const multiplier = Math.pow(10, decimals)
  return Math.round(value * multiplier) / multiplier
}

export function formatNumber(num: number, maxDecimals = 2): string {
  const formatted = num.toFixed(maxDecimals)
  return formatted.replace(/\.?0+$/, '')
}