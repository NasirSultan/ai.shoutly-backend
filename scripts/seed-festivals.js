const XLSX = require('xlsx')
const path = require('path')

const BASE_URL = process.env.API_URL || 'http://localhost:3000'

const TYPE_MAP = {
  'Global': 'GLOBAL',
  'Special Day': 'SPECIAL_DAY',
  'Festival': 'FESTIVAL',
  'National': 'NATIONAL',
}

function excelDateToISO(serial) {
  const utcDays = Math.floor(serial - 25569)
  const date = new Date(utcDays * 86400 * 1000)
  return date.toISOString().split('T')[0]
}

async function main() {
  const filePath = path.join(__dirname, '..', 'Festival Data.xlsx')
  const wb = XLSX.readFile(filePath)
  const ws = wb.Sheets['Sheet1']
  const rows = XLSX.utils.sheet_to_json(ws, { defval: '' })

  const festivals = rows
    .filter((r) => r['Event'] && r['Date'] && r['Type'])
    .map((r) => ({
      date: typeof r['Date'] === 'number' ? excelDateToISO(r['Date']) : r['Date'],
      event: String(r['Event']).trim(),
      type: TYPE_MAP[String(r['Type']).trim()] || 'GLOBAL',
    }))

  console.log(`Seeding ${festivals.length} festivals...`)

  const res = await fetch(`${BASE_URL}/api/festivals/bulk`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(festivals),
  })

  const result = await res.json()
  console.log('Done:', result)
}

main().catch(console.error)
