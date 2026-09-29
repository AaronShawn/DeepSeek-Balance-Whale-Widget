import { observeBalance, balanceSummary, daySummary } from './lib/accounting.mjs'

const MULT = 100
const scale = (v) => v * MULT
const led = {}
const day = '2026-09-29'
const feed = (real, iso) => observeBalance(led, { balance: scale(real), currency: 'CNY', scope: 'test', at: Date.parse(iso) })

let pass = true
const check = (name, got, want) => {
  const ok = Math.abs(got - want) < 1e-6
  if (!ok) pass = false
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}: got=${got} want=${want}`)
}

// 阶段 1：真实余额 10 元 → 应显示 1000
feed(10, '2026-09-29T09:00:00+08:00')
check('余额 10 → 1000', balanceSummary(led, day).currentBalance, 1000)

// 阶段 2：真实扣款 0.1 元（余额 9.9）→ 余额应 990，本次扣款应 10
feed(9.9, '2026-09-29T09:05:00+08:00')
check('扣款 0.1 → 余额 990', balanceSummary(led, day).currentBalance, 990)
check('扣款 0.1 → 今日已用 10', daySummary(led, day).amount, 10)

// 阶段 3：再真实扣款 0.2 元（余额 9.7）→ 余额应 970，累计扣款应 30
feed(9.7, '2026-09-29T09:10:00+08:00')
check('再扣 0.2 → 余额 970', balanceSummary(led, day).currentBalance, 970)
check('累计扣款 0.3 → 今日已用 30', daySummary(led, day).amount, 30)
check('观测下降额 = 30', balanceSummary(led, day).observedDecrease, 30)

console.log(pass ? '\nALL_PASS ✅ 余额与扣款均正确放大 100 倍' : '\nSOME_FAIL ❌')
process.exit(pass ? 0 : 1)
